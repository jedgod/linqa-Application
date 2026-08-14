# Linqa

**Secure messaging that outpaces WhatsApp, Signal, and Telegram.**

Linqa is a next-generation end-to-end encrypted messenger built for 2026 and beyond.  
It combines scalable group encryption (MLS), full post-quantum cryptography by default, strong metadata protection, phone-number-free identity, and excellent multi-device support — all under open, auditable governance.

## Core Security Principles

1. **Default Full E2EE for Everything**  
   1:1 chats, groups of any practical size, channels/broadcasts, bots, and calls are end-to-end encrypted by default using MLS (Messaging Layer Security, RFC 9420) or an improved tree-based group key agreement.

2. **Full Post-Quantum Cryptography by Default**  
   Hybrid classical + post-quantum key agreement and ongoing ratcheting (ML-KEM / Kyber + classical curves). Protects against harvest-now-decrypt-later attacks.

3. **Advanced Metadata Protection**  
   Strong sealed-sender, minimized linkability, optional anonymous / random IDs, no persistent phone-number requirement.

4. **True Multi-Device Security**  
   Full history & media sync across devices without requiring the primary phone to stay online. Forward secrecy and post-compromise security preserved.

5. **Strong Anonymity & Identity Options**  
   Registration without phone number. Username-only, random ID, or fully anonymous modes with secure recovery.

6. **Robust Forward Secrecy + Post-Compromise Security at Scale**  
   Rapid key rotation even in large, dynamic groups.

7. **Client-Side & Device-Level Protections**  
   View-once messages, screenshot detection where possible, local encrypted storage, hardware-backed keys.

8. **Openness, Auditability & Trust**  
   Fully open-source clients and cryptographic core. Regular independent audits. Privacy-first governance (no ads, no data selling).

## Project Structure

```
linqa/
├── docs/                  # Architecture, protocol specs, security model, roadmap
│   ├── architecture.md
│   ├── security.md
│   ├── protocol.md
│   ├── multi-device.md     # Detailed multi-device design
│   ├── roadmap.md
│   └── governance.md
├── protocol/              # Protocol definitions & formal specs
│   ├── mls/
│   │   ├── design.md      # Detailed MLS design for Linqa
│   │   └── README.md
│   ├── pqc/
│   │   ├── parameters.md  # Concrete PQC parameter recommendations
│   │   └── README.md
│   ├── sealed-sender/
│   └── identity/
├── core/                  # Shared cryptographic core (Rust) — v0.2.0
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── identity.rs, enrollment.rs, key_package.rs, envelope.rs, replay.rs
│   │   ├── attachments.rs, backup.rs, groups.rs
│   │   ├── ffi.rs, safety_number.rs, search_tokens.rs
│   │   └── error.rs
│   └── tests/
├── clients/               # Platform clients
│   ├── android/
│   ├── ios/
│   ├── desktop/
│   ├── web/                # ~50 modules: chat UI + relay/auth/attachments/calls/
│   │                          location/contacts/push/safety/billing/voice/milestones/
│   │                          admin/enterprise/AI/collaboration clients + runtime layer
│   └── mobile/             # Expo Router (React Native) scaffold — calls/media tabs,
│                              search, message requests, status, Privacy Center,
│                              settings; auth-flow.ts/SecureKeyStore.ts building blocks
├── server/                # Backend services (minimal trust) — PostgreSQL 18-backed
│   ├── src/
│   │   ├── auth/, db/ (12 migrations), ops/, passkeys/, realtime/,
│   │   │   repositories/, routes/ (~25), services/ (31), jobs/ (7)
│   │   └── app.ts, index.ts, bootstrap/ (service-container.ts, register-all.ts)
│   └── docker-compose.yml
├── vertical-slice/        # Standalone, minimal proof of the encrypted-message-relay
│   │                          path (user → device → key-package → relay → WebSocket
│   │                          wake-up → lease → ack), independent of server/
│   └── docker-compose.yml
├── tests/
│   ├── security/            # stage-by-stage acceptance-test checklists
│   └── protocol-fixtures/    # cross-platform wire-format fixtures
├── ops/
│   ├── disaster-recovery/      # restore-test.sh
│   └── release/                  # verify-artifact.sh
├── tools/
├── scripts/
└── assets/
```

## Priority Implementation Order

1. Default E2EE for large groups & channels (MLS)
2. Full post-quantum ratcheting everywhere
3. Strong metadata minimization + phone-free identity
4. Excellent multi-device security model
5. Open source + independent audits + clean governance

## Status

**Design docs describe the long-term MLS + hybrid-PQC target. What's actually implemented (stages 1–30 of a staged build-out) is a much broader but still disconnected set of real pieces: 1:1 + group-state + attachment + backup cryptography in `core/`, a PostgreSQL-backed server covering auth, relay, calling, push, safety, billing, and launch governance, and client UI shells / integration-client modules that are still not wired to either.**

| Aspect | Status |
|---|---|
| Client UIs (web/desktop/Android/iOS) | **Yes** — conversation list, chat, settings/device management, against in-memory mock data. Not wired to `core/` or `server/` yet. Web additionally has real, mounted (non-mock) Calls/Media/Privacy Center pages — see `clients/web/README.md`. |
| Client integration modules (web) | **~40 modules present, most unmounted** — relay/realtime/auth clients plus attachments, sync, calls/signaling/WebRTC privacy, location sharing, contact discovery, push registration, safety, billing entitlements, disappearing messages, voice notes, milestones/collaboration/AI/enterprise/admin clients. See `clients/web/README.md`. |
| Mobile client (`clients/mobile/`, Expo Router) | **New** — no Expo/React Native project existed before this; a minimal scaffold now hosts a real Calls tab, search, Quick Create sheet, message requests, status/stories viewer, media gallery, Privacy Center, and four settings screens, all querying real server endpoints. No secure session store, no core binding, no native build produced in this environment — see `docs/MOBILE_FEATURES_APPLY_GUIDE.md` and `docs/NEXT_MOBILE_FEATURES_APPLY_GUIDE.md`. |
| Real 1:1 authenticated encryption (`core/`) | **Implemented, code-reviewed, not compiler-verified** — X25519 ephemeral-static key agreement, HKDF-SHA256, XChaCha20-Poly1305, Ed25519 signatures, replay protection, plus chunked attachment encryption (BLAKE3-checked), Argon2id-encrypted backups, and signed hash-chained group state. No Rust toolchain in this environment to actually run `cargo test`. |
| MLS groups / hybrid post-quantum (ML-KEM) | **No** — deferred past this stage; see `docs/protocol.md` for the target design this is building toward. |
| Server (`server/`) | **Yes, verified against real PostgreSQL 18 in this environment, repeatedly** — 12 migrations, relay, key-package directory, device enrollment (fails closed — **two independent, still-incomplete mechanisms now exist**, see `server/README.md`), phone/email OTP auth, attachments (fail-closed pending object storage), multi-device sync, account deletion, calling + call signaling + location sharing (including reading back a shared location during a call, not just publishing it), push (fail-closed pending a real provider), contact discovery, trust & safety, usernames, privacy settings, entitlements, feature flags, a milestone/execution-launch layer (feature promotion INTERNAL→GA with rollback, collaboration rooms, fail-closed confidential AI job queue, communities, business profiles, enterprise policies/SCIM/legal holds — all still disabled/unauthorized by default), and mobile-feature support (status/stories, message requests, scheduled calls, device security alerts, storage summaries). ~25 route groups, 31 services, 7 background jobs. |
| Device enrollment completion | **Fails closed, two ways** — the original flow (`/v1/device-enrollment/*`) returns 503 because it never calls `core/`'s Ed25519 proof verification; a second, newer flow (`/v1/devices/:deviceId/enrollment`) accepts a proof as `202 PENDING` but nothing ever verifies and completes it either. Registering a device end-to-end doesn't work through either path yet. |
| Attachment/push/recorded-video/voice-note storage | **Fails closed** — no S3-compatible object storage, APNs/FCM/Web Push adapter, or KMS-backed token vault is configured; uploads and push delivery refuse rather than fake success. |
| Any two clients actually exchanging an encrypted message | **No** — the pieces exist independently (core crypto, server relay, client UI) but nothing connects them yet. |

What exists today:

- Full architecture, security model, protocol, multi-device, and governance documents describing the **long-term target** (MLS, hybrid PQC, sealed-sender) — see `docs/` and `protocol/`.
- `core/` (v0.2.0): real device identity, enrollment, key packages, message envelopes, replay protection, chunked encrypted attachments, encrypted backups, and signed group state — see `core/README.md`, and `core/tests/e2e_crypto.rs` for round-trip/tamper/replay tests.
- `server/`: the full stage 1–30 surface — see `server/README.md` for a section-by-section breakdown, what was verified against a live database, a list of routes/config values added because shipped clients called endpoints the server pack never defined, and every bug found only by actually running requests (not just typechecking).
- Client UI shells (web, desktop, Android, iOS) against in-memory mock data, plus ~30 not-yet-mounted web integration-client modules matching the server's surface one-for-one — see `clients/web/README.md`.
- CI: `.github/workflows/ci.yml` (Rust fmt/clippy/test across a 3-OS matrix, Postgres-backed server migrate/test/build, web install/audit/test/build, protocol-fixtures presence check) and `release-security.yml` (SBOM, artifact hashing, provenance attestation on tagged releases).
- `docs/production-checklist.md`: consolidated, non-optional checklist — now covering object storage, push infrastructure, TURN/calling, native bindings, key transparency, and launch governance in addition to the original crypto/auth items.
- `tests/security/*.md`: stage-by-stage acceptance-test checklists. `tests/protocol-fixtures/`: cross-platform wire-format fixture (format description only — real byte-identical vectors need a Rust toolchain to generate).

What does **not** exist yet:

- MLS group messaging, hybrid post-quantum key agreement, or sealed-sender — all deferred past this stage
- Device enrollment actually succeeding end-to-end (server-side Ed25519 proof verification isn't wired in)
- Server-side key-package signature validation (the package is stored, but its signature isn't checked yet)
- Any client wired to `core/` or `server/` — everything a user sees is still mock data
- Real object storage, push providers, TURN, or a billing provider — everything in that path fails closed
- Several services implemented but not yet called from any route: `GroupService`, `NetworkRiskService`, `AccountIntegrityService`, `DisappearingMessageService`, `ops/security-event.service.ts` — see `server/README.md` for why each was left unwired rather than force-connected to a guessed-at flow
- A committed `Cargo.lock` — run `cargo generate-lockfile` in `core/` before CI's Rust job will pass
- A Rust toolchain in this environment — `core/` was reviewed carefully by hand but never actually compiled here; run `cargo test` yourself before relying on it

See `docs/roadmap.md`, `docs/production-checklist.md`, and `prototypes/README.md` for the path forward.

## G0-G5 Production Assurance Update (2026-08-09)

The canonical implementation now includes real G0-G4 runtime, identity, encrypted messaging, native custody, provider, migration, and evidence controls plus a G5 production-GA assurance layer. G5 verifies signed and hashed artifacts for supply chain, infrastructure, disaster recovery, load/chaos, observability, privacy, native releases, canary/rollback, independent reviews, and formal approval.

This code does not declare the deployed service GA by itself. `.github/workflows/g5-ga-assurance.yml` fails closed until exact-revision G0-G4 evidence and a trusted Ed25519-signed G5-A through G5-K bundle are supplied through the protected `ga-approval` environment. See `G5_GREEN_LABEL_RULES.md` and `INTEGRATION_ORDER.md`.

## Final Release Closure (2026-08-09)

The final closure layer binds G0-G5, dependency security, Expo 57 alignment, physical iOS/Android certification, external and operational evidence, canary/rollback results, and formal approval to one release version, Git revision, and immutable artifact SHA-256. `.github/workflows/final-release-closure.yml` downloads and promotes that frozen artifact without rebuilding it and fails closed when any evidence is missing, stale, skipped, mocked, mismatched, or not produced on a physical device.

For Android, `clients/android` with application ID `com.linqa.app` is the sole official launch medium. `clients/mobile` is the Expo cross-platform release surface and must remain release-compatible, but it does not replace the official native Android launcher.

The presence of these controls is not a GA declaration. GA remains RED until the protected workflow receives the exact signed artifact, online dependency/security results, signed G0-G5 evidence, both physical-device certifications, canary/rollback proof, and required independent approvals.

## License

AGPL-3.0 (clients & core) — to be confirmed.  
Cryptographic components under more permissive licenses where appropriate.
