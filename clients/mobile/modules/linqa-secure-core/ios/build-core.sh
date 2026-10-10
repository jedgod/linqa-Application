#!/usr/bin/env bash
# Builds the Rust secure core as a static library for iOS and places it where LinqaSecureCore.podspec expects it.
# Needs macOS with Xcode and Rust. Run it on a Mac, or from an EAS build hook (npm script "eas-build-pre-install").
set -euo pipefail
if [ "$(uname)" != "Darwin" ]; then echo "build-core.sh: skipped (needs macOS)"; exit 0; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="$HERE/../../../../../core"
command -v cargo >/dev/null || { curl -sSf https://sh.rustup.rs | sh -s -- -y; . "$HOME/.cargo/env"; }
rustup target add aarch64-apple-ios
( cd "$CORE" && cargo build --release --features uniffi-bindings --target aarch64-apple-ios )
mkdir -p "$HERE/libs"
cp "$CORE/target/aarch64-apple-ios/release/liblinqa_core.a" "$HERE/libs/liblinqa_core.a"
echo "Staged liblinqa_core.a for iOS"
