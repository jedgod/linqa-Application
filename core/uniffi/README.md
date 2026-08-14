# UniFFI Scaffolding for Android & iOS

This directory contains the UniFFI Interface Definition Language (UDL) file and notes for generating mobile bindings.

## Prerequisites

- Rust toolchain
- `uniffi-bindgen` (or the `uniffi` crate with the bindgen feature)
- For Android: Android NDK + Kotlin
- For iOS: Xcode + Swift

## Generating Bindings

```bash
# From the core/ directory
cargo build --features ffi

# Generate Kotlin (Android)
uniffi-bindgen generate src/linqa_core.udl --language kotlin --out-dir ../../clients/android/generated

# Generate Swift (iOS)
uniffi-bindgen generate src/linqa_core.udl --language swift --out-dir ../../clients/ios/generated
```

(Exact paths will be adjusted once the build system is fully wired.)

## Current Status

The UDL file (`linqa_core.udl`) exposes a minimal surface:

- Version
- Error type
- Identity / Device identifiers
- Ciphersuite registry
- Basic device registry

As the Rust core matures (MLS group operations, sealed-sender seal/open, linking ceremony), the UDL will be extended and the generated bindings will automatically pick up the new APIs.

## Integration Plan

1. Keep the UDL in sync with the public Rust API that is safe to expose.
2. Use `uniffi::include_scaffolding!` in `lib.rs` when the `ffi` feature is enabled.
3. Ship pre-generated bindings in the Android / iOS client repositories for faster CI, while still allowing regeneration.
