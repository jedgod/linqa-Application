[CmdletBinding()]
param(
  [ValidateSet('osrm','valhalla')][string]$Engine = 'osrm',
  [string]$BaseUrl = 'http://127.0.0.1:15000',
  [switch]$World
)
$ErrorActionPreference = 'Stop'
$samples = @(@{ Name='Monaco'; From=@(7.4206,43.7311); To=@(7.4260,43.7384) })
if ($World) {
  $samples += @(
    @{ Name='New York'; From=@(-73.9857,40.7484); To=@(-73.9851,40.7589) },
    @{ Name='Tokyo'; From=@(139.7671,35.6812); To=@(139.7731,35.6846) },
    @{ Name='Nairobi'; From=@(36.8219,-1.2921); To=@(36.8172,-1.2864) },
    @{ Name='Sydney'; From=@(151.2069,-33.8731); To=@(151.2093,-33.8688) }
  )
}
foreach ($sample in $samples) {
  if ($Engine -eq 'osrm') {
    $coords = "$($sample.From[0]),$($sample.From[1]);$($sample.To[0]),$($sample.To[1])"
    $route = Invoke-RestMethod -TimeoutSec 30 -Uri "$($BaseUrl.TrimEnd('/'))/route/v1/driving/${coords}?overview=full&geometries=geojson"
    if ($route.code -ne 'Ok' -or $route.routes.Count -lt 1 -or $route.routes[0].geometry.coordinates.Count -lt 2 -or $route.routes[0].distance -lt 0) { throw "$($sample.Name): invalid OSRM route" }
  } else {
    $body = @{ locations=@(@{lon=$sample.From[0];lat=$sample.From[1]},@{lon=$sample.To[0];lat=$sample.To[1]});costing='auto';units='kilometers';shape_format='polyline6' } | ConvertTo-Json -Depth 5 -Compress
    $route = Invoke-RestMethod -TimeoutSec 30 -Uri "$($BaseUrl.TrimEnd('/'))/route" -Method Post -ContentType 'application/json' -Body $body
    if ($route.trip.status -ne 0 -or !$route.trip.legs[0].shape -or $route.trip.summary.length -lt 0) { throw "$($sample.Name): invalid Valhalla route" }
  }
  Write-Output "$Engine route verified: $($sample.Name)"
}
