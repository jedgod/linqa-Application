# linqa-core

Shared cryptographic and protocol library for the Linqa messenger.

## Current stage (v0.2.0): real 1:1 authenticated encryption

This is a focused rewrite that replaced the earlier MLS/hybrid-PQC/sealed-sender
scaffolding with a smaller set of modules implementing real, working
cryptography end-to-end — no placeholders that silently return success:

- **Device identity**: Ed25519 signing key + X25519 encryption key per device (`identity`)
- **Device enrollment**: signed challenge/proof-of-possession handshake (`enrollment`)
- **Key packages**: signed, expiring, publishable per-device key bundles (`key_package`)
- **Message envelopes**: X25519 ephemeral-static key agreement, HKDF-SHA256 key
  derivation, XChaCha20-Poly1305 authenticated encryption, Ed25519 sender
  signature over the ciphertext (`envelope`)
- **Replay protection**: bounded LRU cache of seen message IDs (`replay`)
- **Attachments** (stage 6): per-file random content key, chunked XChaCha20-Poly1305
  with a BLAKE3 integrity manifest over the chunk sequence (`attachments`)
- **Encrypted backups** (stage 9): Argon2id-derived key from a user passphrase,
  XChaCha20-Poly1305, plaintext hash pinned into the AAD (`backup`)
- **Group state** (stage 7): signed, hash-chained group membership/epoch
  transitions — owners/admins only, sequential epochs, previous-state-hash
  binding (`groups`)
- **FFI boundary** (stage 21): a single `FfiCore` wrapping one device's
  identity + a replay cache behind the request/response shapes intended for
  WASM/UniFFI/Tauri bindings (`ffi`) — see "What's not wired up yet" below
- **Safety numbers** (stage 26): deterministic, order-independent fingerprint
  string derived from both parties' identity keys, for out-of-band verification (`safety_number`)
- **Local search tokens** (stage 22): HMAC-based per-term search index tokens
  that never reveal plaintext terms (`search_tokens`)

Every failure path returns a typed `LinqaError` — see `core/tests/e2e_crypto.rs`
for round-trip, tamper-rejection, and replay-rejection tests.

## What this stage deliberately does not include yet

- **MLS group messaging** and **hybrid post-quantum key agreement** (ML-KEM) —
  1:1 only, classical-only, for now. See `../docs/protocol.md` and
  `../protocol/mls/design.md` / `../protocol/pqc/parameters.md` for the
  longer-term target architecture this stage is building toward.
- **Sealed-sender** (metadata protection) and **encrypted local storage** —
  moved out of `core`'s scope for this stage; persistence now lives in the
  server (`server/src/db`), which only ever stores opaque ciphertext.
- **Actual WASM/UniFFI/Tauri bindings** — `ffi.rs` defines the target
  request/response shapes and a working `FfiCore`, but no `wasm-bindgen`,
  `uniffi-bindgen`, or Tauri command layer has been generated from it yet;
  no client calls into this core.
- **Merkle transparency proofs** — `safety_number.rs` derives the
  verification string, but inclusion/consistency proof verification (stage 26)
  isn't implemented; the server's `transparency_roots`/`transparency_leaves`
  tables exist but nothing computes or verifies a tree over them yet.

## Building

```bash
cargo build
cargo test
```

## Structure

```
src/
├── lib.rs
├── error.rs         # LinqaError
├── identity.rs       # DeviceSecrets (Ed25519 + X25519), DevicePublicIdentity
├── enrollment.rs      # EnrollmentChallenge / EnrollmentProof
├── key_package.rs      # KeyPackage create/validate
├── envelope.rs           # MessageEnvelope encrypt/decrypt
├── replay.rs               # ReplayCache
├── attachments.rs            # chunked encrypted attachments + BLAKE3 manifest
├── backup.rs                  # Argon2id-encrypted backup archives
├── groups.rs                    # signed, hash-chained group state
├── ffi.rs                        # FfiCore — target surface for WASM/UniFFI/Tauri
├── safety_number.rs               # verification fingerprint derivation
└── search_tokens.rs                 # HMAC local-search index tokens
```

## Design Documents

- `../docs/architecture.md`
- `../docs/security.md`
- `../docs/multi-device.md`
- `../protocol/mls/design.md`
- `../protocol/pqc/parameters.md`

## Status

Not yet built/tested in this environment (no Rust toolchain available here) —
review before relying on it. `prototypes/cli` exercises the full public API
(`identity`, `key_package`, `enrollment`, `envelope` subcommands) as a smoke
test once a toolchain is available.

This core is consumed by all clients via FFI (UniFFI, cbindgen, or
equivalent) and by the server where appropriate. `core/uniffi/linqa_core.udl`
is the target FFI surface — not yet wired to a `uniffi-bindgen` build step.
