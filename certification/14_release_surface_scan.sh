#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

for f in \
  "$ROOT/clients/android/app/src/main/AndroidManifest.xml" \
  "$ROOT/clients/android/app/src/release/AndroidManifest.xml"
do
  [[ -f "$f" ]] || continue
  if grep -Eqi \
    '(CERT_SEND|CERT_ROTATE|CERT_REVOKE|CERT_INJECT_TAMPER|CertificationReceiver)' \
    "$f"
  then
    write_gate CPK2 FAIL "certification/debug receiver exposed in release manifest"
    fail "debug certification surface found in $f"
  fi
done

write_gate CPK2 PASS "release manifest has no certification control"
pass "release surface"
