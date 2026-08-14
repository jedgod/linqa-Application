# Protocol Fixtures

Cross-platform interoperability test vectors for `linqa-core`'s wire formats
(stage 27 — Interoperability, stage 21 — Native Bindings). Every platform
binding (WASM for web, UniFFI for Android/iOS, Tauri for desktop) should be
able to consume the same fixture and produce byte-identical results, proving
the bindings agree with the Rust reference implementation.

`v1-message-envelope.json` documents the shape (field names, types, byte
lengths) of `core::envelope::MessageEnvelope` — see `core/src/envelope.rs`.
It is a **format description**, not a captured real ciphertext: the example
byte arrays are placeholders. Real fixtures (actual encrypt output against
fixed test keys/nonces, so every binding can assert byte-for-byte equality)
require running `cargo test` against the core, which no Rust toolchain in
this environment could do — generate and commit those before relying on this
directory for actual interop CI gating beyond the "does this directory and
its JSON exist" check in `.github/workflows/ci.yml`.
