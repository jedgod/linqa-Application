# Linqa Desktop Client

Desktop client for Linqa (Windows, macOS, Linux).

## Status

**Frontend UI shell with mock data.** Buildable and runnable as a plain web page (`npm install && npm run dev` inside `src/` root), but the Tauri shell and Rust core are not wired up yet.

- Conversation list, chat view, and settings/device-management UI are functional against in-memory mock data (`src/mock/data.ts`), written in vanilla TS/DOM (no frontend framework)
- `src/services/CoreBridge.ts` mirrors the async, command-style API the real Tauri bridge (`invoke("list_conversations")`, etc.) will expose, so swapping in the real core later shouldn't require UI changes
- Preferred stack: **Tauri** (Rust backend + web frontend) so we can reuse the same `linqa-core` crate directly
- `src-tauri/` (Rust side) is still scaffolding — commands, `linqa-core` dependency, and the Tauri crate itself remain commented out until the core is buildable

## Planned Architecture (Tauri)

```
desktop/
├── src/                    # Frontend (vanilla TS + DOM)
│   ├── mock/                # In-memory mock data standing in for linqa-core
│   ├── services/             # CoreBridge
│   ├── utils/                 # dom.ts (element builder), format.ts
│   ├── main.ts, styles.css, index.html
├── src-tauri/              # Rust side
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs          # calls into linqa-core
│   ├── Cargo.toml
│   └── tauri.conf.json
└── README.md
```

## Why Tauri (preferred)

- The cryptographic core is already Rust → no extra FFI boundary for crypto
- Small binary size and good security posture compared with Electron
- Same `linqa-core` crate used by mobile (via UniFFI) can be linked directly here
- Frontend can stay minimal

## Integration with linqa-core

On desktop the core is a normal Rust dependency:

```toml
# src-tauri/Cargo.toml (planned)
[dependencies]
linqa-core = { path = "../../../core" }
tauri = { version = "2", features = [] }
```

All sensitive operations stay on the Rust side; the frontend only receives high-level commands and encrypted data.

## Current Blockers

- No Rust toolchain / Tauri CLI in the present environment
- Real crypto provider not implemented
- No server / relay

See top-level `docs/` and `core/` for the shared design.
