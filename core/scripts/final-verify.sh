#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features --locked
cargo build --release --locked

if command -v wasm-pack >/dev/null 2>&1; then
  wasm-pack build --release --target web \
    --out-dir ../../clients/web/src/generated/linqa-core
else
  echo "wasm-pack is unavailable; WASM bindings were not generated." >&2
  exit 2
fi