$ErrorActionPreference = "Stop"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust is not installed. Install rustup and stable Rust first."
}

cargo fmt --all -- --check
if ($LASTEXITCODE -ne 0) { throw "cargo fmt failed with exit code $LASTEXITCODE." }

cargo clippy --all-targets --all-features -- -D warnings
if ($LASTEXITCODE -ne 0) { throw "cargo clippy failed with exit code $LASTEXITCODE." }

cargo test --all-features --locked
if ($LASTEXITCODE -ne 0) { throw "cargo test failed with exit code $LASTEXITCODE." }

cargo build --release --locked
if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE." }

if (Get-Command wasm-pack -ErrorAction SilentlyContinue) {
    wasm-pack build --release --target web `
        --out-dir ../../clients/web/src/generated/linqa-core
    if ($LASTEXITCODE -ne 0) { throw "wasm-pack failed with exit code $LASTEXITCODE." }
}
else {
    Write-Warning "wasm-pack is unavailable; WASM bindings were not generated."
}

Write-Host "Rust verification and available binding generation completed."