#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
command -v wasm-pack >/dev/null 2>&1 || {
  echo "wasm-pack is required to generate web bindings." >&2
  exit 2
}

wasm-pack build --release --target web \
  --out-dir ../../clients/web/src/generated/linqa-core

echo "Web bindings generated. Android/iOS UniFFI generation remains fail-closed until the UDL build is reviewed."