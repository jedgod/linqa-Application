param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][string]$RestoreDatabaseUrl
)

$ErrorActionPreference = "Stop"
$dump = Join-Path $env:TEMP "linqa-restore-verify.dump"
pg_dump $DatabaseUrl --format=custom --file=$dump
pg_restore --clean --if-exists --no-owner --dbname=$RestoreDatabaseUrl $dump
psql $RestoreDatabaseUrl -v ON_ERROR_STOP=1 -c @"
SELECT count(*) AS transparency_events FROM key_transparency_events;
SELECT count(*) AS backup_manifests FROM backup_manifests;
SELECT count(*) AS relay_envelopes FROM message_envelopes;
"@
Write-Output "Restore verification completed."
