param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskContainer = 'linqa-chat-feature-tests-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$taskCreated = $false
$taskEnvKeys = @('NODE_ENV','DATABASE_URL','JWT_ISSUER','JWT_AUDIENCE','JWT_HS256_SECRET','JWT_JWKS_URL','JWT_SIGNING_PRIVATE_KEY_PEM','JWT_VERIFYING_PUBLIC_KEY_PEM','CONTACT_DISCOVERY_SECRET','TOKEN_VAULT_KEY_BASE64','TURN_SHARED_SECRET','LINQA_REQUIRE_DB_TESTS','LINQA_MIGRATIONS_DIR')
$taskOriginalEnv = @{}
foreach ($taskKey in $taskEnvKeys) { $taskOriginalEnv[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process') }
Push-Location -LiteralPath (Join-Path $taskRoot 'server')
try {
  docker image inspect postgres:16 *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 16 is not cached. Pull postgres:16 before running this test.' }
  docker run --rm --detach --name $taskContainer --label linqa.task=chat-feature-verification --publish '127.0.0.1::5432' --env POSTGRES_USER=linqa_feature_test --env POSTGRES_PASSWORD=linqa_feature_test_only --env POSTGRES_DB=linqa_feature_test postgres:16
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated PostgreSQL test container.' }
  $taskCreated = $true
  $taskReady = $false
  for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    docker exec $taskContainer pg_isready --username=linqa_feature_test --dbname=linqa_feature_test *> $null
    if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $taskReady) { throw 'The isolated test database did not become ready.' }
  $taskAddress = (docker port $taskContainer 5432/tcp).Trim()
  if ($LASTEXITCODE -ne 0 -or $taskAddress -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'The test database must be bound only to loopback.' }
  $taskPort = $Matches[1]
  # These are disposable test fixtures, never production credentials.
  $env:NODE_ENV = 'test'
  $env:DATABASE_URL = "postgresql://linqa_feature_test:linqa_feature_test_only@127.0.0.1:${taskPort}/linqa_feature_test"
  $env:JWT_ISSUER = 'https://linqa-feature-tests.local'
  $env:JWT_AUDIENCE = 'linqa-feature-tests'
  $env:JWT_HS256_SECRET = 'chat-feature-integration-test-secret-only'
  $env:JWT_JWKS_URL = $null
  $env:JWT_SIGNING_PRIVATE_KEY_PEM = $null
  $env:JWT_VERIFYING_PUBLIC_KEY_PEM = $null
  $env:CONTACT_DISCOVERY_SECRET = 'chat-feature-contact-test-secret-only'
  $env:TOKEN_VAULT_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  $env:TURN_SHARED_SECRET = 'chat-feature-turn-test-secret-only'
  $env:LINQA_REQUIRE_DB_TESTS = '1'
  $env:LINQA_MIGRATIONS_DIR = Join-Path $taskRoot 'server/src/db/migrations'
  npm.cmd run db:migrate
  if ($LASTEXITCODE -ne 0) { throw 'Migrations failed on the isolated test database.' }
  npm.cmd run test -- src/tests/protected-media.integration.test.ts --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL chat integration tests failed.' }
} finally {
  if ($taskCreated) { docker stop $taskContainer *> $null }
  foreach ($taskKey in $taskEnvKeys) { [Environment]::SetEnvironmentVariable($taskKey, $taskOriginalEnv[$taskKey], 'Process') }
  Pop-Location
}

