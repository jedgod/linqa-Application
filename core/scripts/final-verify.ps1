$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "verify-and-bind.ps1")
if ($LASTEXITCODE -ne 0) { throw "Core verification failed with exit code $LASTEXITCODE." }

if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    throw "wasm-pack is required for final verification; bindings were not generated."
}