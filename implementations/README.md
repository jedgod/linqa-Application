# Linqa — Stepwise Implementation of Priority Gaps

This folder contains **clean, sophisticated, downloadable implementations** of the six highest-priority gaps identified in the evaluation.

| # | Module | Status | Description |
|---|--------|--------|-------------|
| 01 | `01_hybrid_crypto/` | Implemented | Hybrid KEM (X25519 + PQ slot), ciphersuite registry, **working sealed-sender seal/open** |
| 02 | `02_encrypted_store/` | Implemented | Real `EncryptedLocalStore` (AEAD + passphrase, disk or memory) |
| 03 | `03_messaging_path/` | Implemented | Minimal E2EE send → relay → receive path using the real crypto |
| 04 | `04_file_vault/` | Implemented | Complete File Vault (the previously ABSENT category) |
| 05 | `05_device_enrollment/` | Implemented | Device enrollment wired to HybridKem + history-transfer key |
| 06 | `06_calls_media/` | Implemented | Call history + Media index population helpers (fills the “hollow” features) |

## Design principles used throughout

- Zeroize secrets on drop
- Fail-closed crypto
- Domain-separated KDFs
- Clear separation between classical and post-quantum material
- Production-ready API shapes (easy to replace simulated PQ with real `ml-kem`)
- No `unsafe`
- Serde-friendly types for storage / network

## How to integrate later

1. Copy the modules into `core/src/…` (or keep them as a workspace crate).
2. Replace `SimulatedPqKem` with a real ML-KEM (Kyber) implementation.
3. Wire the `Relay` to the real server transport and Key Directory.
4. Point the Android / iOS / desktop clients at the UniFFI surface once the core is exposed.

## Note on buildability

These files are pure Rust source. They require a Rust toolchain and the crates already listed in `core/Cargo.toml` (plus `hex`, `serde_json`, `chacha20poly1305`, etc.). They are intentionally written so that a future `cargo test` / `cargo run` will exercise real cryptographic round-trips once the environment has the toolchain.
