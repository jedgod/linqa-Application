[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$prefix = $workspace + '\'
$operations = [Collections.Generic.List[object]]::new()

function Assert-WorkspacePath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path leaves the Linqa workspace: $full"
    }
    $cursor = $full
    while ($cursor -and $cursor -ne $workspace) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing cleanup through a reparse point: $cursor"
            }
        }
        $cursor = Split-Path -Parent $cursor
    }
    return $full
}

function Add-Operation([string]$Action, [string]$Source, [string]$Destination = '') {
    $sourcePath = Assert-WorkspacePath $Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { return }
    $targetPath = if ($Destination) { Assert-WorkspacePath $Destination } else { '' }
    if ($targetPath -and (Test-Path -LiteralPath $targetPath)) { throw "Destination exists: $targetPath" }
    $operations.Add([pscustomobject]@{
        Action = $Action
        Source = $sourcePath.Substring($prefix.Length).Replace('\', '/')
        Destination = if ($targetPath) { $targetPath.Substring($prefix.Length).Replace('\', '/') } else { '' }
        Bytes = (Get-Item -LiteralPath $sourcePath).Length
        SHA256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    })
}

# Preserve reference content; the root TSX files are designs, not app imports.
Get-ChildItem -LiteralPath $workspace -File -Force | ForEach-Object {
    $name = $_.Name
    if (($name.EndsWith('.txt') -and $name -ne 'LaunchApp.txt') -or $name -like 'Linqa_Calls_*.tsx') {
        $folder = if ($name -match '^(claude|codex)|^linqa-diagnose') { 'assessments' }
                  elseif ($name.EndsWith('.tsx')) { 'designs' } else { 'implementation-notes' }
        Add-Operation 'Move' $_.FullName (Join-Path $workspace "docs\reference\$folder\$name")
    }
    elseif ($name -match '^\.runtime-linqa-.*\.(png|xml)$|^device_.*\.xml$|^galaxy.*\.(png|xml)$|^linqa[_-].*\.xml$|^linqaAndroid\.png$|^linqa-device-screen\.png$|^michael-account-server.*\.log$') {
        Add-Operation 'Delete' $_.FullName
    }
}

# Only known generated file types are removed from scratch directories.
foreach ($relative in @('screenshots-now', 'tmp')) {
    $directory = Assert-WorkspacePath (Join-Path $workspace $relative)
    if (Test-Path -LiteralPath $directory) {
        Get-ChildItem -LiteralPath $directory -Recurse -File -Force | Where-Object {
            $_.Extension -in @('.png', '.xml', '.log')
        } | ForEach-Object { Add-Operation 'Delete' $_.FullName }
    }
}
foreach ($relative in @('clients\web\tsconfig.tsbuildinfo', 'clients\mobile\device_ui_3.xml')) {
    Add-Operation 'Delete' (Join-Path $workspace $relative)
}
$export = Assert-WorkspacePath (Join-Path $workspace 'clients\mobile\dist-android-check')
if (Test-Path -LiteralPath $export) {
    Get-ChildItem -LiteralPath $export -Recurse -File -Force | ForEach-Object { Add-Operation 'Delete' $_.FullName }
}

if (-not $Apply -or $WhatIfPreference) {
    $operations | Select-Object Action, Source, Destination, Bytes | Format-Table -AutoSize
    Write-Output ("Preview: {0} moves, {1} generated files to delete." -f @($operations | Where-Object Action -eq Move).Count, @($operations | Where-Object Action -eq Delete).Count)
    return
}

# Persist the exact inventory before changing anything.
$report = Join-Path $workspace 'docs\maintenance\workspace-cleanup-2026-09-10.json'
if (Test-Path -LiteralPath $report) { throw 'Cleanup report already exists; review it before running another cleanup.' }
New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null
$operations | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $report -Encoding UTF8
foreach ($operation in $operations) {
    $sourcePath = Assert-WorkspacePath (Join-Path $workspace $operation.Source)
    if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $operation.SHA256) {
        throw "File changed after review: $sourcePath"
    }
    if ($PSCmdlet.ShouldProcess($sourcePath, $operation.Action)) {
        if ($operation.Action -eq 'Move') {
            $targetPath = Assert-WorkspacePath (Join-Path $workspace $operation.Destination)
            New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
            Move-Item -LiteralPath $sourcePath -Destination $targetPath
            if ((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne $operation.SHA256) { throw 'Move verification failed' }
        } else { Remove-Item -LiteralPath $sourcePath -Force }
    }
}
# Remove only empty directories inside the obsolete export and screenshot folder.
foreach ($relative in @('clients\mobile\dist-android-check', 'screenshots-now')) {
    $directory = Assert-WorkspacePath (Join-Path $workspace $relative)
    if (Test-Path -LiteralPath $directory) {
        @(Get-ChildItem -LiteralPath $directory -Directory -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending) + @(Get-Item -LiteralPath $directory) | ForEach-Object {
            $target = Assert-WorkspacePath $_.FullName
            if (-not (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1)) {
                Remove-Item -LiteralPath $target -Force
            }
        }
    }
}
Write-Output ("Completed {0} operations; moved references verified by SHA-256. Inventory: {1}" -f $operations.Count, $report)
