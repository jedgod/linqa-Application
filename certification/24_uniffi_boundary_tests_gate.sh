#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

# UJB-05: runs the real Rust private-key-boundary integration tests
# (core/tests/uniffi_private_key_boundary.rs, core/tests/secret_canary_boundary.rs)
# against the exact `NativeSecureCore` UniFFI object surface Kotlin/JNA
# binds to, and records the outcome as a gate rather than only leaving it
# as a `cargo test` a developer might forget to run.
OUT="$EVIDENCE_DIR/uniffi-boundary-tests.txt"

if ! (cd "$ROOT/core" && cargo test --features uniffi-bindings \
      --test uniffi_private_key_boundary --test secret_canary_boundary > "$OUT" 2>&1); then
  write_gate UJB5 FAIL "core/tests/uniffi_private_key_boundary.rs or secret_canary_boundary.rs failed"
  cat "$OUT"
  exit 1
fi

cat "$OUT"
write_gate UJB5 PASS "uniffi_private_key_boundary + secret_canary_boundary Rust tests pass"
pass "uniffi private-key boundary tests"
