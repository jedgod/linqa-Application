[CmdletBinding()]
param(
  [ValidateSet('osrm','valhalla')][string]$Engine = 'osrm',
  [ValidateSet('World','Smoke')][string]$Coverage = 'World',
  [string]$DataRoot,
  [string]$MapPbf,
  [int]$Port = 0,
  [switch]$AllowPlanetDownload,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (!$DataRoot) { $DataRoot = Join-Path $repo '.runtime/routing' }
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$coverageRoot = Join-Path $DataRoot $Coverage.ToLowerInvariant()
$engineRoot = Join-Path $coverageRoot $Engine
function Docker-Run([string[]]$Arguments) {
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed ($LASTEXITCODE). Inspect the output above." }
}
$dockerMemory = & docker info --format '{{.MemTotal}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop in Linux-container mode.' }
if ($Coverage -eq 'World') {
  $drive = [IO.Path]::GetPathRoot($DataRoot).TrimEnd('\').TrimEnd(':')
  $free = (Get-PSDrive -Name $drive -ErrorAction Stop).Free
  # Conservative local deployment policy, not a claim about vendor minimums.
  if ($free -lt 512GB -or [double]$dockerMemory -lt 64GB) {
    throw 'World build not started. This deployment requires at least 512 GiB free and 64 GiB allocated to Docker as a starting capacity guard; benchmark the chosen engine before sizing production. Use a larger data drive/machine or run -Coverage Smoke to validate installation.'
  }
  if (!$MapPbf -and !$AllowPlanetDownload) { throw 'Provide -MapPbf pointing to a planet extract, or explicitly pass -AllowPlanetDownload after provisioning capacity.' }
}
New-Item -ItemType Directory -Path $engineRoot -Force | Out-Null
$target = Join-Path $engineRoot 'map.osm.pbf'
if ($MapPbf) {
  $source = (Resolve-Path -LiteralPath $MapPbf).Path
  if ($source -ne $target) { Copy-Item -LiteralPath $source -Destination $target }
} elseif (!(Test-Path -LiteralPath $target)) {
  $url = if ($Coverage -eq 'World') { 'https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf' } else { 'https://download.geofabrik.de/europe/monaco-latest.osm.pbf' }
  & curl.exe --fail --location --retry 3 --continue-at - --output "$target.partial" $url
  if ($LASTEXITCODE -ne 0) { throw 'Map download failed; the partial file is retained for resume.' }
  & curl.exe --fail --location --retry 3 --output "$target.md5" "$url.md5"
  if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the map integrity checksum.' }
  $expected = ((Get-Content -LiteralPath "$target.md5" -Raw).Trim() -split '\s+')[0]
  $actual = (Get-FileHash -LiteralPath "$target.partial" -Algorithm MD5).Hash
  if ($actual -ine $expected) { throw 'Map checksum does not match. The graph was not built.' }
  Move-Item -LiteralPath "$target.partial" -Destination $target
}
if (!(Test-Path -LiteralPath $target) -or (Get-Item -LiteralPath $target).Length -eq 0) { throw 'Map file is missing or empty.' }
$image = if ($Engine -eq 'osrm') { 'ghcr.io/project-osrm/osrm-backend:latest' } else { 'ghcr.io/valhalla/valhalla-scripted:latest' }
Docker-Run -Arguments @('pull', $image)
$digest = (& docker image inspect --format '{{index .RepoDigests 0}}' $image).Trim()
if ($LASTEXITCODE -ne 0 -or !$digest.Contains('@sha256:')) { throw 'Could not lock the routing image digest.' }
$lockPath = Join-Path $coverageRoot "$Engine.lock.env"
$dataValue = $coverageRoot.Replace('\','/')
$imageKey = if ($Engine -eq 'osrm') { 'OSRM_IMAGE' } else { 'VALHALLA_IMAGE' }
Set-Content -LiteralPath $lockPath -Encoding ascii -Value @("ROUTING_DATA_ROOT=$dataValue", "$imageKey=$digest")
if ($Engine -eq 'osrm') {
  $mount = "$($engineRoot.Replace('\','/')):/data"
  Docker-Run -Arguments @('run','--rm','-v',$mount,$digest,'osrm-extract','-p','/opt/car.lua','/data/map.osm.pbf')
  Docker-Run -Arguments @('run','--rm','-v',$mount,$digest,'osrm-partition','/data/map.osrm')
  Docker-Run -Arguments @('run','--rm','-v',$mount,$digest,'osrm-customize','/data/map.osrm')
}
if ($Port) { $portKey = if ($Engine -eq 'osrm') { 'OSRM_PORT' } else { 'VALHALLA_PORT' }; Add-Content -LiteralPath $lockPath -Value "$portKey=$Port" }
if (!$PrepareOnly) {
  # Valhalla's maintained scripted image generates a complete config and builds tiles on first start.
  Docker-Run -Arguments @('compose','--env-file',$lockPath,'-f',(Join-Path $PSScriptRoot 'compose.yaml'),'--profile',$Engine,'up','-d',$Engine)
}
Write-Output "Prepared $Engine / $Coverage. Image and data configuration: $lockPath"
Write-Output 'Smoke coverage is Monaco only. It is not worldwide routing. Leave Linqa production settings unchanged until a World graph is built and tested.'
