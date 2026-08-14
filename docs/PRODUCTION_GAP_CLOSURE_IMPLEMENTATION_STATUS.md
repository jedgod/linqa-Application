# Production Gap Closure v1.0 — Implementation Status

Date: 2026-08-09

This repository applies the production-gap pack to the existing canonical architecture. It does not introduce the pack's illustrative duplicate server or crypto implementations.

## Implemented in code

- Production web messaging fails closed onto the Rust/WASM secure core; demo fallback is not selectable in production.
- `ChatView` sends through the production coordinator and persists encrypted outgoing envelopes before relay submission.
- The relay accepts opaque, strictly encoded envelopes only and rejects plaintext-like fields.
- Key packages are device-signed, enrollment-bound, expiration-checked, and appended to the transparency log.
- UniFFI exposes the canonical Rust secure core to native clients; Kotlin and Swift bindings are generated under `core/generated`.
- Mobile defines a fail-closed native-core bridge and an account-partitioned SQLite encrypted outbox with retry metadata.
- Runtime capability probes expose structured `READY`, `DEGRADED`, `NOT_CONFIGURED`, or `FAILED` states. Production startup refuses to proceed without database, secure core, delivery, relay, and key transparency.
- Delivery and infrastructure capabilities are registered centrally, including APNs, FCM, object storage, TURN, billing, KMS, escalation, Redis, and CountryLinqa risk.
- Sensitive account deletion uses a signed, action/user/device-bound, expiring, one-time step-up token. String-prefix authorization is removed.
- Database migrations use SHA-256 checksums, a PostgreSQL advisory lock, timing/application metadata, dirty-state detection, and idempotent replay checks.
- Phone-first registration, optional recovery email verification, multi-account isolation, and recovery workflows remain connected to the canonical server/client paths.
- Mobile feature entry points are hidden when the server capability or workflow flag is unavailable.
- CI includes PostgreSQL, Redis, and an S3-compatible service and executes migrations twice to test clean install plus upgrade replay.

## Verified on this host

- Rust: `cargo test --all-features` — 20 tests passed.
- Rust: `cargo fmt --all -- --check` and strict all-target/all-feature Clippy — passed.
- Server: TypeScript production build — passed.
- Server: Vitest — 27 files, 104 tests passed.
- Web: production build — passed.
- Web: Vitest — 7 files, 19 tests passed.
- Mobile: TypeScript type-check — passed.
- UniFFI: Kotlin and Swift bindings generated successfully. Missing optional `ktlint` and `swift-format` produced formatting warnings only.
- Server and web production dependency audits — zero vulnerabilities.

## Release gates that require the deployment environment

- Install Android and Apple Rust compilation targets and produce signed device artifacts. This Windows host generated language bindings but does not have those cross-compilation targets installed.
- Upgrade the existing Expo 52/React Native toolchain through a tested major-version migration. Its production dependency tree currently reports 25 advisories (4 moderate, 20 high, 1 critical); npm's available full remediation is a breaking Expo 57 upgrade, so it was not force-applied as an untested transitive rewrite.
- Run the clean-install/upgrade CI job against its PostgreSQL/Redis/S3 containers. Docker Desktop is not running on this host.
- Configure real SMS/email, APNs/FCM, KMS, TURN, object-store, billing, Redis, and CountryLinqa-risk providers. The capability registry deliberately reports missing providers instead of simulating readiness.
- Execute the two-fresh-client black-box acceptance suite with live OTP mailbox/device automation and `LINQA_E2E_HELPERS_WIRED=1`. Release promotion remains deliberately blocked until that external harness is supplied.

These are release-environment gates, not silent mock fallbacks. The production bootstrap and acceptance assertion fail closed when they are absent.
