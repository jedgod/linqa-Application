$ErrorActionPreference = "Stop"

$coreRoot = Split-Path -Parent $PSScriptRoot
$generatedRoot = Join-Path $coreRoot "generated"

Push-Location $coreRoot
try {
  cargo build --release --features uniffi-bindings
  if ($LASTEXITCODE -ne 0) { throw "Host UniFFI library build failed" }

  $hostLibrary = Join-Path $coreRoot "target\release\linqa_core.dll"
  if (-not (Test-Path -LiteralPath $hostLibrary)) {
    throw "Host UniFFI library was not produced at $hostLibrary"
  }

  $kotlinOutput = Join-Path $generatedRoot "kotlin"
  $swiftOutput = Join-Path $generatedRoot "swift"
  New-Item -ItemType Directory -Force -Path $kotlinOutput | Out-Null
  New-Item -ItemType Directory -Force -Path $swiftOutput | Out-Null
  cargo run --features uniffi-cli --bin uniffi-bindgen -- generate --library $hostLibrary --language kotlin --out-dir $kotlinOutput
  if ($LASTEXITCODE -ne 0) { throw "Kotlin UniFFI binding generation failed" }
  cargo run --features uniffi-cli --bin uniffi-bindgen -- generate --library $hostLibrary --language swift --out-dir $swiftOutput
  if ($LASTEXITCODE -ne 0) { throw "Swift UniFFI binding generation failed" }

$targets = @(
  "aarch64-apple-ios",
  "aarch64-apple-ios-sim",
  "aarch64-linux-android",
  "x86_64-linux-android"
)

foreach ($target in $targets) {
  $installed = rustup target list --installed
  if ($installed -contains $target) {
    cargo build --release --features uniffi-bindings --target $target
    if ($LASTEXITCODE -ne 0) { throw "Native core build failed for $target" }
  } else {
    Write-Warning "Rust target $target is not installed; artifact remains a release gate."
  }
}

Write-Host "Native secure-core artifact pass completed."
} finally {
  Pop-Location
}
