# Production Checklist

Consolidated from the server/auth/core implementation packs (stages 1–30,
the three production milestones, milestone execution/launch, and the full
gap-closure pack). Nothing here is done by default — every box must be
actively completed before real users are allowed on this system.

> The backend deliberately does not decrypt messages or receive private
> keys. OIDC/JWKS verification is implemented, but production issuer,
> audience, and key-rotation configuration must be validated. Key-package
> signatures must be validated server-side, and WebSocket notifications should use Redis or another
> pub/sub layer when running multiple server instances. (See the matching
> items below, and `vertical-slice/RUN_GUIDE.txt` item 12 for the same
> checklist scoped to the standalone vertical-slice backend.)

## Cryptography & core

- [ ] Independent cryptographic review of `core/` (identity, enrollment, key_package, envelope, replay)
- [ ] Protocol test vectors and fuzzing for all binary parsers
- [ ] Independently review the implemented hybrid ML-KEM construction and its known-answer/interoperability vectors; do not claim reviewed PQC before that gate passes
- [x] Verify Ed25519 device-enrollment proofs before activation and token issuance
- [ ] Integrate the Rust core with clients through versioned WASM/UniFFI bindings — clients are not wired to `core/` yet. `clients/web/src/core/SecureCoreBridge.ts` defines the intended interface and ships only `FailClosedCoreBridge`; nothing in this repo generates or loads a real WASM binding to satisfy it.
- [x] Keep the signed-proof enrollment route as the mounted activation mechanism; the superseded V2 enrollment routes remain deregistered and covered by a route test
- [ ] Complete encrypted local storage on every client. Web has `EncryptedIndexedDbStore`; mobile/desktop still require a reviewed encrypted database and search index

## Server & data

- [ ] Validate production OIDC/JWKS issuer, audience, rotation, and outage behavior (the verifier is implemented in `server/src/auth/jwt.ts`)
- [ ] Bind access tokens to active device records
- [ ] Complete server-side key-package signature validation (currently stores the package but does not verify its signature — see `routes/key-packages.ts` and `vertical-slice/src/routes/key-packages.ts`)
- [ ] Back WebSocket notifications with Redis (or another pub/sub layer) once the server runs as more than one instance — `RealtimeHub` (both `server/src/realtime/hub.ts` and `vertical-slice/src/realtime/hub.ts`) only tracks connections in local process memory, so a client connected to instance A never receives a wake-up triggered on instance B
- [ ] SQL row-level authorization tests
- [ ] Key-transparency consistency proofs or an externally auditable log
- [ ] Replay/lease persistence review beyond the current per-row Postgres locking
- [ ] Encrypted attachment pipeline
- [ ] Abuse prevention without plaintext inspection
- [ ] Database TLS, encryption at rest, backups, and restoration drills; least-privilege DB roles — `ops/disaster-recovery/restore-test.sh` exists but has never been run against a real backup
- [ ] Real SMS provider (with delivery status callbacks) and transactional email provider (DKIM/SPF/DMARC) — `DevConsoleDeliveryProvider` refuses to run outside development and must be replaced
- [ ] CAPTCHA after suspicious activity (not by default)
- [ ] Per-IP, per-device, and per-identifier rate limits beyond the global Fastify rate limiter
- [ ] Phone-number recycling / SIM-swap risk signals where available
- [ ] Validate the implemented S3-compatible object storage against a production private bucket, KMS policy, blocked public access, lifecycle deletion, checksum verification, and outage tests
- [ ] APNs/FCM/Web Push adapters + a KMS/HSM-backed token vault — push registration and delivery both fail closed via `FailClosedPushProvider`/`FailClosedTokenVault` until these exist
- [ ] IP-geolocation source for `NetworkRiskService` (VPN/proxy/ASN/country/impossible-travel signals) — implemented but has no data feed
- [ ] Wire `AccountIntegrityService`/`NetworkRiskService`/`DisappearingMessageService`/`GroupService`/`ops/security-event.service.ts` into the request flows they're meant to gate (registration, call creation, message send, group membership changes, device revocation) — all implemented, none are called from a route yet
- [ ] A real billing provider webhook contract (Stripe/Apple/Google) — `EntitlementService.applyWebhook` exists and is idempotent, but nothing calls it yet
- [x] Populate `call_history` transactionally when calls end and `media_index` transactionally when attachment uploads complete
- [ ] Add `callsHistory`/`mediaGallery`/`privacyCenter` capability keys to `clients/web/src/runtime/features.ts` (and report them `READY` once the above is true) — `LiveCapabilityGuard` on these three pages currently has nothing to check them against, so in `LIVE` mode they will always show "Feature unavailable" until this is added

## Milestones, collaboration, AI, and enterprise

- [x] Enforce organization-scoped authorization for SCIM and other organization routes
- [x] Enforce release-promotion separation of duties by rejecting requester self-approval transactionally
- [ ] A seeding/administration path for `milestone_feature_flags` — no route or script creates a flag row, and `milestone_promotions.feature_key` has a foreign key into that table, so `POST /v1/admin/promotions` fails until an operator inserts one directly
- [ ] A reviewed confidential-compute provider for `CONFIDENTIAL_CLOUD` AI jobs — `FailClosedConfidentialAiProvider` refuses every job until one is wired in; `ON_DEVICE` mode is unaffected since it never leaves the client
- [ ] Legal-hold audit events — `LegalHoldService.create`/`release` write to `legal_holds` only; nothing writes to `organization_audit_events` for hold lifecycle actions yet, despite that table existing for exactly this
- [ ] Business-profile verification review workflow — `business_profiles.verification_status` exists (`UNVERIFIED`/`PENDING`/`VERIFIED`/`REJECTED`) but nothing transitions it; every profile stays `UNVERIFIED` forever
- [ ] Real-time collaboration delivery — `collaboration_events` are stored and can be pulled, but nothing pushes them over the existing `RealtimeHub` the way envelope-available/call-signaling notifications already do; `collaboration_subscriptions` (tracking `last_delivered_clock` per device) exists with nothing reading or writing it

## Mobile client (`clients/mobile/`)

- [x] Store mobile account sessions in `expo-secure-store` and bridge the active access token into authenticated service clients
- [ ] Reconcile the two, now three-including-this-one, overlapping status/stories implementations: `user_status_posts` (this pack — encrypted, privacy-scoped) vs. `user_status_updates` (a separate, concurrent, plaintext, dev-seeded addition to this same repo). Pick one before building a real status feature on top of either
- [ ] Wire `app/(tabs)/calls.tsx`'s call buttons to the existing call-creation/signaling services (`POST /v1/calls`, `/v1/calls/signaling`) — today they are decorative
- [x] Persist notification, accessibility, storage, and AI privacy settings through authenticated server APIs
- [ ] Decrypt message-request previews and status content in a real secure core — `GET /v1/message-requests` currently returns the literal string `"Encrypted message request"` for every row instead of a decrypted preview, since no core binding exists for this client
- [ ] Wire status replies as real encrypted direct messages through `routes/relay.ts` — `POST /v1/status/:statusId/replies` currently stores replies in an isolated `status_replies` table that never becomes a conversation message
- [x] Mount linked-device alerts in Privacy Center with real acknowledgement and remote-revocation actions
- [ ] Reinstall and re-verify on a real device before relying on this client again — a real Android debug build was produced, installed, and launched successfully on a connected physical device (`npx expo run:android`, confirmed via `adb shell dumpsys activity`), then deliberately uninstalled to avoid confusion with the real native Linqa app (`com.linqa.app`) already on that same device. No iOS build was attempted (no macOS/Xcode environment available)
- [ ] `app.json`'s `newArchEnabled` is currently `false` as a workaround for a Windows `MAX_PATH` (260-character) limit hit by the New Architecture's CMake/ninja build for `react-native-screens`/`react-native-safe-area-context` under this repo's long path — re-evaluate once building from a shorter path or with Windows long-path support enabled

## Authentication & sessions

- [x] Verify passkey registration and authentication through `@simplewebauthn/server` in the mounted V2 passkey flow
- [ ] Store refresh tokens only in secure platform storage (Keychain/Keystore on mobile; HttpOnly SameSite cookies for web — the current `AuthClient`/`MobileAuthFlow` hold them in memory/caller-provided storage only)
- [ ] Session management UI and remote sign-out
- [ ] Recovery code regeneration and one-time display; account recovery holds
- [ ] Security notifications for new devices and identifier changes
- [ ] Step-up authentication for: adding/removing identifiers, disabling passkeys, viewing recovery codes, exporting message history, revoking trusted devices, changing recovery settings
- [ ] Generic responses to prevent account enumeration (already applied to `/v1/auth/challenges`; audit any new endpoints for the same)

## Calling, location, and safety

- [ ] Hardened TURN deployment (UDP/TCP/TLS), validate the implemented short-lived HMAC credential issuance against it, and enforce relay-only mode for privacy-mode calls
- [ ] Verify step-up tokens cryptographically rather than by string prefix — `routes/account-deletion.ts` currently just checks `stepUpToken.startsWith("stepup_")`
- [ ] Object-storage deletion workers for recorded video / voice notes / attachments (queued by retention jobs, never actually deleted from storage yet since no storage is configured)
- [ ] Passkey confirmation for account deletion; deletion reminder notifications at 30/7/1 days; inactive-account deletion scheduler
- [ ] Liveness-mode restrictions rejecting prerecorded media as live; visible call-mode/recording indicators in every client UI
- [ ] Location consent UI + one-tap revocation in every client; confirm location is excluded from logs/analytics (server already never logs plaintext location — the ciphertext-only `encrypted_location_events` table and short 2-minute max event lifetime are implemented)
- [ ] Staff/admin moderation UI with least-privilege RBAC for `safety_reports`/`moderation_actions` — schema and service exist, no UI or role model yet
- [ ] Legal review for evidence retention and safety-report data handling

## Native bindings, privacy, and launch

- [ ] Generate real WASM (web) and UniFFI (Android/iOS) bindings from `core::ffi::FfiCore` — the Rust-side surface exists (`core/src/ffi.rs`), nothing generates or ships bindings from it yet
- [ ] Hardware-backed platform key storage (Android Keystore, iOS Keychain/Secure Enclave, desktop DPAPI/Keychain) — `clients/mobile/SecureKeyStore.ts`'s `FailClosedSecureKeyStore` is the only implementation, and it always fails; no client wires it in
- [ ] Encrypted local database + search-token index design and implementation (`core::search_tokens` derives HMAC tokens; no local DB exists to index yet)
- [ ] Merkle inclusion/consistency proof verification for key transparency — `transparency_roots`/`transparency_leaves` tables and `core::safety_number` exist; nothing computes or verifies a tree over them
- [ ] Username abuse controls and reserved-name policy beyond the 90-day reuse cooldown already implemented
- [ ] Device-reputation appeal/review workflow — `AccountIntegrityService.evaluateDevice` scores devices but nothing acts on the score or lets a user appeal
- [ ] Staged-rollout dashboards, launch-gate ownership assignment, and a tested emergency rollback — `feature_flags`/`launch_gates` tables and `FeatureFlagService` exist with no operator UI

## Operations & release

- [ ] Independent security review / penetration test
- [ ] SAST, dependency review, secret scanning
- [ ] Incident response and key/device-compromise recovery procedures
- [ ] Signed release artifacts and SBOM; reproducible build evidence — `.github/workflows/release-security.yml` generates an SBOM, hashes, and provenance attestation on every `v*` tag, and `ops/release/verify-artifact.sh` verifies a checksum + signature, but no actual signing key/process exists yet, so nothing is signed
- [ ] Audit-log retention and privacy rules
- [ ] Remove all demo/mock security claims from production UI (web already gates "encrypted"/"post-quantum" labels behind real runtime state — verify this holds for every client before release)
- [ ] Execute the canonical protocol fixtures byte-for-byte on Android, iOS, and desktop; Rust and web fixture parity is verified locally
