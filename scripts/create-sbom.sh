#!/usr/bin/env bash
set -euo pipefail
out="${1:-artifacts/sbom}"
mkdir -p "$out"
command -v syft >/dev/null 2>&1 || { echo "syft required" >&2; exit 1; }
syft dir:. -o cyclonedx-json="$out/linqa.cdx.json"
sha256sum "$out/linqa.cdx.json" > "$out/linqa.cdx.json.sha256"
