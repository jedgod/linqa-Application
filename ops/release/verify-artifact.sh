#!/usr/bin/env bash
set -euo pipefail

artifact="${1:?artifact path required}"
checksum_file="${2:?checksum file required}"
signature_file="${3:?signature file required}"
public_key="${4:?public key required}"

sha256sum --check "$checksum_file"
openssl dgst \
  -sha256 \
  -verify "$public_key" \
  -signature "$signature_file" \
  "$artifact"

echo "Artifact checksum and signature verified."
