# Linqa Full Gap Closure — Apply Guide

1. Apply server migration `009_gap_closure.sql`.
2. Register new services and `registerGapClosureRoutes`.
3. Add scopes: `devices:enroll`, `calls:read`, `media:read`, `privacy:read`, `notifications:write`.
4. Generate and load real Rust/WASM bindings.
5. Implement `EncryptedLocalStore` using encrypted IndexedDB on web and SQLCipher/native secure storage on mobile/desktop.
6. Replace mock message send with `ProductionMessagingCoordinator`.
7. Start `OutboxWorker` on authentication, connectivity restoration, and application resume.
8. Mount `CallsPage`, `MediaGalleryPage`, and `PrivacyCenterPage`.
9. Run server, web, Rust, and end-to-end tests.
10. Keep `VITE_LINQA_RUNTIME_MODE=HYBRID` until a complete encrypted round trip passes.

Status in this repo: steps 1-3 and 8 are applied. Step 4 is **not done** - no
Rust toolchain is available in this environment (consistent with every prior
pack in this repository); `core/` was not touched, and no WASM bindings were
generated or loaded, so `BrowserCoreRuntimeProbe` still finds no
`globalThis.linqaCore` and `FailClosedCoreBridge` (this pack's own fail-closed
stub) is what a client actually gets today. Step 5 is **not done** - the pack
only supplies the `EncryptedLocalStore` interface and its fail-closed stub,
not a real encrypted-IndexedDB implementation; writing one is a substantial,
security-sensitive piece of work (key management, at-rest encryption,
migration) that this pack did not include code for. Step 6 is **deliberately
not done** - `ProductionMessagingCoordinator` is applied and ready to use, but
it is not wired into `ChatView`/`App.tsx` in place of the existing mock send,
matching how every other "integration client" in this repo has been handled:
wiring an unfinished, unencrypted-by-default path in front of the one thing
that currently works (the mock chat demo) would make the demo worse, not
better, until steps 4-5 are real. Step 7 (`OutboxWorker`) is supplied but
nothing calls `runOnce()` from anywhere - there is no auth/connectivity/resume
hook wired to it yet, for the same reason as step 6. Step 8 is done: all
three pages are mounted and reachable from the sidebar, each behind
`LiveCapabilityGuard`. Step 9's server/web suites were run against this
pack's own additions (see verification notes in `server/README.md`); the
supplied `tests/e2e/gap-closure.spec.ts` is `it.todo()` placeholders only -
none of it is implemented or wired into any test runner's config, so it does
not execute in CI. Step 10: `clients/web/.env.example` already defaults
`VITE_LINQA_RUNTIME_MODE=DEMO` (not `HYBRID`), and no complete encrypted round
trip exists, so this repo remains further from LIVE than step 10 assumes as
its starting point.
