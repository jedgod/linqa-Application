param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $taskRoot
try {
  $featureTests = @(rg --files tests clients/mobile/features/conversation/__tests__ | Where-Object {
    $_ -match 'tests[\\/](conversation.*|shared-attachments|media-validation)\.test\.ts$' -or $_ -match 'features[\\/]conversation[\\/]__tests__[\\/].*\.test\.ts$'
  })
  node --import ./server/node_modules/tsx/dist/loader.mjs --test @featureTests
  if ($LASTEXITCODE -ne 0) { throw 'Chat regression tests failed.' }
  Push-Location server
  try {
    npm.cmd run chat:test
    if ($LASTEXITCODE -ne 0) { throw 'Backend chat tests failed.' }
    npx.cmd vitest run --config vitest.chat-features.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'Native adapter tests failed.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
  } finally { Pop-Location }
  Push-Location clients/mobile
  try {
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Mobile typecheck failed.' }
  } finally { Pop-Location }
} finally { Pop-Location }
