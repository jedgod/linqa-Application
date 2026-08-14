#!/usr/bin/env bash
set -euo pipefail
artifact="${1:?artifact required}"
out="${2:-artifacts/signatures}"
mkdir -p "$out"
command -v cosign >/dev/null 2>&1 || { echo "cosign required" >&2; exit 1; }
cosign sign-blob --yes --bundle "$out/$(basename "$artifact").sigstore.json" "$artifact"
sha256sum "$artifact" > "$out/$(basename "$artifact").sha256"
