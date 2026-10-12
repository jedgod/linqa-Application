param(
  [ValidateRange(1,65535)][int]$ApiPort = 8088,
  [ValidateRange(1,65535)][int]$MetroPort = 8082,
  [string[]]$Serial = @('LMX320969df2b0', 'R9TT703HH0Y')
)
$ErrorActionPreference = 'Stop'
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$adb = Join-Path $sdk 'platform-tools/adb.exe'
if (!(Test-Path -LiteralPath $adb)) { throw 'Android platform-tools/adb.exe was not found.' }
$health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/health/ready" -TimeoutSec 5
if ($health.service -ne 'linqa-api' -or $health.status -ne 'ready') { throw "Port $ApiPort is not a ready Linqa API." }
$devices = @(& $adb devices -l)
if ($LASTEXITCODE -ne 0) { throw 'Could not list Android USB devices.' }
$connected = @($devices | ForEach-Object { if ($_ -match '^(\S+)\s+device(?:\s|$)') { $Matches[1] } })
# Include authorized Wi-Fi transports for the same test-phone models.
$Serial = @($Serial) + @($devices | ForEach-Object { if ($_ -match '^(\S+)\s+device\s.*\bmodel:(LM_X320|SM_A037U)\b') { $Matches[1] } }) | Select-Object -Unique
$restored = 0
foreach ($deviceSerial in $Serial) {
  if ($deviceSerial -notin $connected) { Write-Warning "$deviceSerial is disconnected, offline, or awaiting USB authorization."; continue }
  foreach ($port in @(8080,8088)) {
    & $adb -s $deviceSerial reverse "tcp:$port" "tcp:$ApiPort"
    if ($LASTEXITCODE -ne 0) { throw "Could not restore API forwarding for $deviceSerial." }
  }
  foreach ($port in @(8081,8082,8083)) {
    & $adb -s $deviceSerial reverse "tcp:$port" "tcp:$MetroPort"
    if ($LASTEXITCODE -ne 0) { throw "Could not restore Metro forwarding for $deviceSerial." }
  }
  # Keeping stdin open briefly lets Android netcat receive the HTTP response.
  $probe = & $adb -s $deviceSerial shell "(printf 'GET /health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'; sleep 1) | toybox nc -W 3 -w 3 127.0.0.1 8080"
  if ($LASTEXITCODE -ne 0 -or ($probe -join "`n") -notmatch 'HTTP/1\.1 200 OK' -or ($probe -join "`n") -notmatch '"service":"linqa-api"') { throw "The API tunnel check failed on $deviceSerial." }
  "Restored $deviceSerial; phone 127.0.0.1:8080 reaches the ready Linqa API on host port $ApiPort."
  $restored++
}
if (!$restored) { throw 'Reconnect and unlock a target phone, authorize USB debugging, then run this command again.' }
