# Stages ONLY CountryLinqa-owned paths so unrelated edits are not swept into the commit.
# Never `git add -A` here. Files edited by more than one feature are listed in $shared:
# stage their CountryLinqa hunks yourself with `git add -p <file>`.
$ErrorActionPreference = "Stop"

$owned = @(
  "server/src/services/countrylinqa",
  "server/src/routes/countrylinqa",
  "server/src/tests/countrylinqa*",
  "server/src/jobs/countrylinqa-workers.ts",
  "server/src/db/migrations/044_countrylinqa_discovery_engine.sql",
  "clients/mobile/app/countrylinqa",
  "clients/mobile/app/settings/countrylinqa.tsx",
  "clients/mobile/services/countrylinqa*",
  "scripts/countrylinqa*",
  "scripts/require-db-tests.mjs",
  "scripts/audit-vitest-skips.mjs",
  "scripts/assert-dedicated-test-db.mjs",
  "scripts/commit-countrylinqa-only.ps1",
  "tests/countrylinqa-certification.test.ts",
  "tests/load/k6-countrylinqa-discovery.js",
  "ops/observability/countrylinqa-alert-rules.yml",
  "docs/countrylinqa",
  "certification/countrylinqa/evidence.example.json",
  "certification/countrylinqa/ANDROID_TWO_COUNTRY_RUN.md",
  "certification/countrylinqa/IOS_BLOCKER.md",
  ".github/workflows/countrylinqa-certification.yml"
)
$shared = @(
  "server/package.json", "server/src/config.ts", "server/src/bootstrap/register-all.ts",
  "server/src/chat/chat-redis-bus.ts", "clients/mobile/app/_layout.tsx", ".github/workflows/mobile-startup.yml"
)

git add -- $owned
Write-Host "`n--- STAGED ---"
git diff --cached --stat
Write-Host "`n--- SHARED FILES: stage CountryLinqa hunks manually (git add -p) ---"
foreach ($file in $shared) {
  if (git status --porcelain -- $file) { Write-Host "  modified: $file" }
}
$answer = Read-Host "`nCommit ONLY the staged files? (yes/no)"
if ($answer -ne "yes") { Write-Host "Cancelled. Staged files were kept."; exit 1 }
git commit -m "feat(countrylinqa): discovery engine, shared cache and certification gates"
