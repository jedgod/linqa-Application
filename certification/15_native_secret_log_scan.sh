#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

OUT="$EVIDENCE_DIR/native-secret-log-static-scan.txt"
: > "$OUT"

grep -RniE \
  '(println!|eprintln!|log::|tracing::|android_log).*(private|secret|seed|ed25519|x25519|ml.?kem)' \
  "$ROOT/core/src" >> "$OUT" || true

if [[ -s "$OUT" ]]; then
  write_gate CPK3 FAIL "possible native secret logging found"
  cat "$OUT"
  exit 1
fi

write_gate CPK3 PASS "no obvious native private-key logging found"
pass "native secret log scan"
