$ErrorActionPreference = "Stop"

# Never use `git add -A` here. Stage only CountryLinqa-owned paths.
git add -- `
  "server/src/services/countrylinqa" `
  "server/src/routes/countrylinqa" `
  "server/src/tests/countrylinqa*" `
  "clients/mobile/app/countrylinqa" `
  "clients/mobile/app/settings/countrylinqa.tsx" `
  "clients/mobile/services/countrylinqa*" `
  "scripts/countrylinqa*" `
  "scripts/require-db-tests.mjs" `
  "scripts/audit-vitest-skips.mjs" `
  ".github/workflows/countrylinqa-certification.yml" `
  "certification/countrylinqa"

Write-Host "`n--- STAGED COUNTRYLINQA DIFF ---"
git diff --cached --stat
git diff --cached --name-only

$answer = Read-Host "Commit ONLY these staged CountryLinqa files? (yes/no)"
if ($answer -ne "yes") {
  Write-Host "Commit cancelled. Staged files were not discarded."
  exit 1
}

git commit -m "feat(countrylinqa): close repo-native discovery certification gaps"
