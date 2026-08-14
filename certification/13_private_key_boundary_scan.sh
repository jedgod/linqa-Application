#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

OUT="$EVIDENCE_DIR/private-key-boundary-scan.txt"
: > "$OUT"

# Real repo path is clients/android/app/src/main/java (the pack assumed
# clients/android/src/main/java, which doesn't exist in this checkout).
PATTERN='(privateKeyBytes|rawPrivateKey|rawSigningPrivateKey|rawEncryptionPrivateKey|getPrivateKeyBytes|exportPrivateKey|ed25519PrivateBytes|x25519PrivateBytes)'

for root in \
  "$ROOT/clients/android/src/main" \
  "$ROOT/clients/android/app/src/main/java"
do
  [[ -d "$root" ]] || continue
  grep -RniE "$PATTERN" "$root" >> "$OUT" || true
done

if [[ -s "$OUT" ]]; then
  write_gate CPK1 FAIL "broad raw private-key exposure API found"
  cat "$OUT"
  exit 1
fi

write_gate CPK1 PASS "no broad Kotlin raw private-key API detected"
pass "private-key boundary"
