#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

# UJB-01: the real repo binds `linqa-core` to Android exclusively through
# UniFFI + JNA (uniffi.linqa_core.NativeSecureCore, generated from
# core/src/uniffi_api.rs and consumed via com.sun.jna.* — see
# clients/android/app/build.gradle.kts). This gate fails closed if a
# second, parallel raw-JNI binding (a `native fun` declaration plus a
# hand-written `JNI_OnLoad`/`Java_com_..._nativeXxx` C entry point) is ever
# introduced alongside it — the exact "two native bindings for the same
# core" duplication the pack warns about.
OUT="$EVIDENCE_DIR/uniffi-no-parallel-jni-scan.txt"
: > "$OUT"

# 1) No Kotlin/Java `native fun`/`native <type>` declarations anywhere in
#    the Android app (that's the raw-JNI declaration syntax; UniFFI/JNA
#    bindings never use it — they call through com.sun.jna.Library instead).
grep -RniE '\bnative\s+(fun|[A-Za-z_<>]+\s+\w+\s*\()' \
  "$ROOT/clients/android/app/src/main/java" \
  --include="*.kt" --include="*.java" >> "$OUT" 2>/dev/null || true

# 2) No hand-written JNI C/C++ entry points or a second Rust FFI module
#    exporting the `Java_...` naming convention (raw JNI's calling
#    convention, distinct from UniFFI's `uniffi_linqa_core_fn_*` symbols).
grep -RniE 'JNIEXPORT|JNI_OnLoad|extern "C".*Java_com_linqa' \
  "$ROOT/core/src" "$ROOT/clients/android" \
  --include="*.rs" --include="*.c" --include="*.cpp" --include="*.h" >> "$OUT" 2>/dev/null || true

# 3) No second `pub mod` in core/src/lib.rs implementing a raw android_ffi/
#    jni-style surface alongside the real `uniffi_api` module.
if grep -qE '^\s*pub mod\s+(android_ffi|jni_bridge|jni)\b' "$ROOT/core/src/lib.rs" 2>/dev/null; then
  echo "core/src/lib.rs declares a parallel raw-JNI module" >> "$OUT"
fi

if [[ -s "$OUT" ]]; then
  write_gate UJB1 FAIL "parallel raw-JNI binding surface detected alongside UniFFI/JNA"
  cat "$OUT"
  exit 1
fi

write_gate UJB1 PASS "no parallel raw-JNI binding; UniFFI/JNA is the sole native binding"
pass "no parallel JNI"
