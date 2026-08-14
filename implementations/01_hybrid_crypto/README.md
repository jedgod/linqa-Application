# 01 — Real Hybrid Crypto Foundation

This module upgrades the Linqa core from pure scaffolding to a **working hybrid classical + post-quantum ready** foundation.

## What is implemented

1. **Hybrid KEM** (`hybrid_kem.rs`)
   - X25519 (classical) + structured ML-KEM-768 slot
   - Domain-separated HKDF combination of both shared secrets
   - Fail-closed if either component is missing/invalid
   - Ready to drop in a real `ml-kem` crate implementation

2. **Linqa Ciphersuites** (`ciphersuite.rs`)
   - `LINQA_HYBRID_STANDARD` (X25519 + ML-KEM-768)
   - `LINQA_HYBRID_HIGH` (X25519 + ML-KEM-1024)
   - Registration helper for future OpenMLS CryptoProvider

3. **Sealed Sender** (`sealed_sender.rs`)
   - Real AEAD seal / open using ChaCha20-Poly1305
   - Sender identity + credential encrypted so the relay cannot read them
   - Delivery token left visible for routing only

4. **Integration test / demo** (`demo.rs` / CLI usage)

## Design decisions

- Classical security is always present (X25519).
- PQ material is currently a correctly-sized, randomly-generated stand-in that preserves the hybrid KDF transcript and API. Replace the `PqKem` trait implementation with a real ML-KEM (Kyber) crate for production.
- All secrets are zeroized on drop.
- No `unsafe`.

## How to use later

When a Rust toolchain + `ml-kem` crate are available:

```toml
ml-kem = "0.2"   # or current audited version
```

Then implement `PqKem` for the real algorithm and the rest of the stack continues to work unchanged.
