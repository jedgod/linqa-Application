#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$DIR/20_uniffi_no_parallel_jni_scan.sh"
python3 "$DIR/21_uniffi_binding_allowlist_scan.py"
python3 "$DIR/22_uniffi_kotlin_visibility_scan.py"
python3 "$DIR/23_uniffi_rust_visibility_scan.py"
bash "$DIR/24_uniffi_boundary_tests_gate.sh"
python3 "$DIR/25_uniffi_jna_verdict.py"
