# Linqa Prototypes & Next-Phase Work

| Item | Location | Status |
|------|----------|--------|
| Real 1:1 encryption core (identity, enrollment, key packages, envelopes, replay) | `../core/` | Implemented, not compiler-verified here (see `core/README.md`) |
| Key Directory / transparency log design | `../server/key-directory/design.md` (design) + `../server/src/services/key-transparency.service.ts` (implemented, hash-chained) | Design + working implementation |
| UniFFI scaffolding (Android / iOS) | `../core/uniffi/` | UDL kept in sync with `core/`'s current surface; not wired to a build step |
| MLS + hybrid-PQC ciphersuites, sealed-sender | `../protocol/mls/`, `../protocol/pqc/`, `../protocol/sealed-sender/` | Design only — deferred past the current core stage, see `../core/README.md` |
| Simple CLI prototype | `cli/` | Working skeleton exercising the real `core/` API |

## CLI Prototype

```bash
cd prototypes/cli
cargo run -- info
cargo run -- identity
cargo run -- key-package --user-id alice --device-id alice-phone
cargo run -- enroll --user-id alice --device-name "Alice's phone" --platform ANDROID
cargo run -- envelope --message "hello bob"
```

(Requires the `linqa-core` path dependency to build. No Rust toolchain was
available to actually run this in the environment these files were written
in — review before relying on it.)

## Next after this

- Wire `server/src/routes/enrollment.ts`'s completion endpoint to `core/`'s
  `enrollment::verify_proof` (currently fails closed with 503)
- Add server-side key-package signature validation using `core/`'s
  `key_package::validate_key_package`
- Compile `core/` to WASM and native (UniFFI) targets and wire it into the
  clients (all four currently run on mock data only)
- MLS group messaging and hybrid post-quantum key agreement — deferred past
  this stage, see `../docs/protocol.md` for the target design
