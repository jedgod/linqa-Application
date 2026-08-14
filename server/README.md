# Linqa Server

Designed under a **minimal trust** model: the server only ever stores opaque
ciphertext and public routing/identity metadata. It never receives plaintext
messages, private keys, or recovery secrets, and it cannot decrypt message
content.

> The backend deliberately does not decrypt messages or receive private
> keys. Before production use, the development JWT setup should be
> replaced with OIDC/JWKS, key-package signatures must be validated
> server-side, and WebSocket notifications should use Redis or another
> pub/sub layer when running multiple server instances. See
> `docs/production-checklist.md` for the full list.

A separate, standalone proof of the encrypted-message-relay path (user →
device → key-package → relay → WebSocket wake-up → lease → ack) lives in
`../vertical-slice/` — a minimal package outside this one, useful for
demonstrating or testing the flow in isolation without the other 25+ stages
implemented here.

## Status: PostgreSQL-backed, real persistence, unverified end-to-end

Buildable and runnable (`npm install && npm run dev`), backed by a real
PostgreSQL database (see "Running locally" below). Verified in this
environment, twice (once for the auth/relay/enrollment foundation, again
after adding stages 6–30): all 6 migrations apply cleanly in order, the
server builds, unit tests pass, and a broad sample of routes — including
every route added in stages 6–30 — was manually exercised against a live
database and confirmed to fail closed (400/401, never a raw 500) without
authentication. **Not** verified: device enrollment completion and
key-package signature validation are intentionally still fail-closed (see
below) — no message has actually been end-to-end encrypted and delivered
through this server yet, because no client is wired to `core/`.

## What's implemented

Foundation (auth + relay):
- **Relay** (`routes/relay.ts`, `repositories/relay.repository.ts`): idempotent envelope submission, `FOR UPDATE SKIP LOCKED` delivery leasing, acknowledgement, expiry — plus a WebSocket channel (`routes /v1/realtime`, `realtime/hub.ts`) that notifies a recipient's connected devices the moment an envelope lands, so clients don't have to poll.
- **Key packages** (`routes/key-packages.ts`): publish/rotate signed key packages, active-package-per-device uniqueness, append-only key-transparency event log (`services/key-transparency.service.ts`) with each event hash-chained to the previous one per user.
- **Device enrollment** (`routes/enrollment.ts`): challenge/proof-of-possession handshake. Completion currently **fails closed with 503** — it does not yet call into `linqa-core`'s Ed25519 verification (`enrollment::verify_proof`), so no device can actually complete registration through the HTTP API yet. This is deliberate: accepting an unverified proof would be worse than refusing.
- **Phone/email authentication** (`routes/auth.ts`, migration `002_authentication.sql`): OTP challenge/verify with scrypt-hashed codes and anti-enumeration responses, refresh-token rotation with reuse detection (revokes the whole token family), recovery codes, and passkeys (`routes/passkeys.ts`, `services/passkey-v2.service.ts`) backed by real `@simplewebauthn/server` registration/authentication verification against `webauthn_credentials`/`webauthn_challenges`.
- **Auth**: JWTs (`auth/jwt.ts`) verified via remote JWKS (RS256/ES256/EdDSA) when `JWT_JWKS_URL` is configured — required in production, where the server refuses to boot without it; HS256 with a shared secret remains available as a development-only fallback.

Stages 6–10 (attachments, groups, sync, backups, operations — migration `003_stages_6_10.sql`):
- **Attachments** (`routes/attachments.ts`, `services/attachment.service.ts`): multipart upload session creation against an `ObjectStorage` interface. No S3-compatible storage is configured, so uploads **fail closed** (`services/storage/fail-closed-object-storage.ts`) until one is wired in.
- **Multi-device sync** (`routes/sync.ts`, `services/sync.service.ts`): push/pull of opaque encrypted per-device records with a logical clock, idempotent on `(source_device_id, client_record_id)`.
- **Operational kill switches** (`services/kill-switch.service.ts`): four DB-backed switches (message send, attachment upload, device enrollment, backup restore), seeded disabled by migration, checked before sensitive operations.
- **Groups** (`services/group.service.ts`): hash-chained, sequential-epoch group state storage with owner/admin-only writes. No route registered yet — the pack's own APPLY_GUIDE only calls for attachment and sync routes at this stage; the core-side verification (`core::groups::verify_group_transition`) exists and is ready once a route is added.
- **Audit/notifications** (`ops/security-event.service.ts`): structured audit-event and user-notification helpers, not yet called from any route (ready for wiring into enrollment/device-revocation flows).

Stages 11–15 (account deletion, calls, retention, location — migration `004_stages_11_15.sql`):
- **Account deletion** (`routes/account-deletion.ts`): step-up-gated scheduling (7/14/30-day delay) + cancellation, plus `jobs/account-deletion.worker.ts` which processes due jobs, honors active retention holds, and idempotently anonymizes the account.
- **Calls, location grants, and location events** (`routes/calls.ts` — **not in the supplied pack**, added here since the APPLY_GUIDE explicitly calls for registering these routes and the services were already complete; see "Gaps filled" below): call session create/end, per-call consent-scoped location sharing grants, and encrypted location event publication matching the shipped web `LocationExchangeService`.
- **Recorded video** (`routes/recorded-videos.ts` — also added, same reasoning): registers recorded-video metadata (never live) with a retention policy, and marks a video viewed (queuing deletion for view-once/delete-after-view policies).
- **Network risk** (`services/network-risk.service.ts`): VPN/proxy/ASN/country/impossible-travel scoring — implemented, not yet called from any route (needs an IP-geolocation source this pack doesn't provide).

Stages 16–20 (push, contact discovery, signaling, trust & safety — migration `005_stages_16_20.sql`):
- **Push notifications** (`routes/push.ts`, `services/push.service.ts`): endpoint registration and opaque-payload delivery. No APNs/FCM/Web Push adapter or KMS-backed token vault is configured, so **both registration and delivery fail closed** (`services/push/fail-closed-push-provider.ts`) — there is no safe way to store a raw push token without a real vault.
- **Contact discovery** (`routes/contact-discovery.ts`, `services/contact-discovery.service.ts`): HMAC-keyed lookup tokens, never raw phone/email values. Needs `CONTACT_DISCOVERY_SECRET` (see "Gaps filled").
- **Call signaling** (`realtime/signaling.register.ts` — **not in the supplied pack**, added since the shipped web `AuthenticatedSignalingClient` has nothing to connect to otherwise): authenticated WebSocket at `/v1/calls/signaling` that validates call participancy, persists each signaling event (`services/signaling.service.ts`), and forwards it to the recipient device's live connection via the same `RealtimeHub` used for envelope-available notifications.
- **Trust & safety** (`routes/safety.ts`, `services/trust-safety.service.ts`): blocking (ends active calls between the two users immediately) and report submission with severity-based SLA.

Stages 21–30 (usernames, privacy, entitlements, feature flags, protocol capability — migration `006_stages_21_30.sql`):
- **Usernames** (`routes/usernames.ts`): 30-day change cooldown, 90-day reservation on release.
- **Privacy settings** and **entitlements** (`routes/privacy.ts`, `routes/entitlements.ts` — **not in the supplied pack**, added because the shipped web `PrivacySettingsClient`/`EntitlementClient` call these exact URLs and nothing else would ever serve them): profile visibility/discoverability/read-receipt toggles; billing-driven feature entitlements (`services/entitlement.service.ts` also includes idempotent webhook processing, not yet exposed as a route since no billing provider webhook contract was supplied).
- **Protocol capability** and **feature flags** (`routes/protocol-capability.ts`, `routes/feature-flags.ts` — added for the same "register services" instruction, previously unreachable): per-device protocol version range publication with `negotiate()`; deterministic percentage-bucketed rollout with allow/deny lists and minimum-version gating.
- **Disappearing messages** and **account integrity** (`services/disappearing-message.service.ts`, `services/account-integrity.service.ts`): expiry computation and device-reputation scoring — implemented, not yet wired into the send/registration flows they're meant to gate.

Three Production Milestones (Linqa 1.0/2.0/3.0 feature gating — migration `007_three_milestones.sql`):
- **Milestone feature flags** (`routes/milestone-platform.ts`, `services/milestone.service.ts`): deterministic percentage-bucketed rollout per feature key, gated on the owning milestone (`1.0`/`2.0`/`3.0`) being `ACTIVE` in `product_milestones` — 2.0 and 3.0 ship seeded as `PLANNED`, so nothing under them can ever resolve `enabled` today regardless of a flag's own state.
- **Collaboration rooms** (`services/collaboration.service.ts`): append-only, logical-clock-ordered encrypted event log (whiteboard deltas, tasks, polls, screen-share start/stop) for a `collaboration_rooms` row — no route creates a room yet, only appends/pulls events on one.
- **AI job queue** (`services/ai-job.service.ts`): creates an `ai_processing_jobs` row; `CONFIDENTIAL_CLOUD` mode requires the caller to already have encrypted the input client-side (server never sees plaintext), `DISABLED` mode always rejects.
- **Enterprise policy storage** (`services/enterprise-policy.service.ts`): per-organization key/value policy storage — see "Milestone Execution and Launch" below for what actually issues organizations and enforces policies.

Milestone Execution and Launch (release promotion, collaboration/AI/enterprise completion — migration `008_execution_launch.sql`):
- **Release promotion** (`routes/execution-launch.ts`, `services/release-promotion.service.ts`): request → approve → active, gated on every `release_gate_results` row for that milestone being `PASS`/`WAIVED`; approval flips the target `milestone_feature_flags` row live; rollback immediately disables it again. Nothing seeds `milestone_feature_flags` rows, so a promotion request against a feature key with no existing flag row fails on the `milestone_promotions.feature_key` foreign key — see `docs/EXECUTION_AND_LAUNCH_APPLY_GUIDE.md`.
- **AI worker** (`jobs/ai-worker.ts`, `services/ai-worker.service.ts`): `FOR UPDATE SKIP LOCKED` job leasing so concurrent workers never double-process a job; `FailClosedConfidentialAiProvider` refuses every job until a reviewed confidential-compute provider is wired in.
- **Communities** (`routes/execution-launch.ts`, `services/community.service.ts`): creates a community and its owner membership atomically.
- **Business profiles** (`services/business-profile.service.ts`): one profile per user, upserted.
- **SCIM** (`services/scim.service.ts`): upserts a directory user scoped to an `organizationId` path parameter — **has no organization-scoped authorization**; any caller holding `scim:write` can currently provision users into an organization they don't belong to. Do not enable in production before this is fixed (see `docs/EXECUTION_AND_LAUNCH_APPLY_GUIDE.md`).
- **Legal holds** (`services/legal-hold.service.ts`): create/release per organization.
- **Video-call location: showing + acceptance** (`routes/calls.ts`'s new `GET /v1/calls/:callId/location-events`, `LocationSharingService.listEvents`, and the web `location/CallLocationReceiver.ts` + `location/CallLocationBanner.tsx`): the existing call location-sharing code (`location-grants`, `location-events` POST) only ever let a device *publish* its own encrypted location — there was no way for the other call participant to read it back, so a shared location could never actually be shown. Added a participant-scoped read endpoint plus a receiving-side client that requires an explicit `accept()` (a UI "Show location" action) before it will decrypt or display anything, mirroring the existing sender-side `assertLocationConsent` pattern.

Full Gap Closure (calls tab, media gallery, Privacy Center, durable outbox contract — migration `009_gap_closure.sql`), written directly in response to `claudeassess.txt`'s findings:
- **Calls tab** (`routes/gap-closure.ts`'s `GET /v1/calls/history`, `GapClosureService.listCalls`, web `pages/CallsPage.tsx`): closes the assessment's "Calls Tab - ABSENT" finding. Reads `call_history` (a new table — nothing before this pack ever wrote call outcomes anywhere queryable) joined to `user_profiles` for a display name. Mounted and reachable from the web sidebar today; nothing yet writes rows into `call_history` when a real call ends, so the page is reachable but will show "No call history yet" against a real backend until something calls an insert for it (not supplied by this pack).
- **Media gallery** (`GET /v1/media`, `GapClosureService.listMedia`, web `pages/MediaGalleryPage.tsx`): closes the assessment's "Media Gallery - ABSENT" finding, same caveat — `media_index` is a new table with nothing populating it yet from the attachment/voice-note/recorded-video pipelines.
- **Privacy Center** (`GET /v1/privacy-center`, `GapClosureService.privacySummary`, web `pages/PrivacyCenterPage.tsx`): a single endpoint aggregating real devices, real `auth_sessions`, real `blocked_users`, and real `privacy_settings` for a user, plus a heuristic 0-100 "privacy score." This is real, queried-live data (not mock), unlike the rest of the assessment's "Privacy Center - PARTIAL" finding — it directly improves that category, though passkeys/biometrics/data-export/auto-delete remain absent.
- **Device enrollment (second, parallel mechanism)** (`POST /v1/devices/:deviceId/enrollment`, `DeviceEnrollmentService`): stores a client-submitted enrollment proof as `PENDING` against a `device_enrollments` row and returns `202 Accepted`. **This is a second, independent device-enrollment concept alongside the existing `routes/enrollment.ts` (`/v1/device-enrollment/challenges` + `/v1/device-enrollment/complete`, backed by `device_registration_challenges`)** — the two do not share a table or a code path. Neither one can currently reach a working end state: the original flow fails closed with `503` at completion because no Ed25519 verifier is wired in; this new flow accepts the proof and stores it `PENDING` (`202`, not an error) but `DeviceEnrollmentService.complete()` — the only thing that would ever flip it to `VERIFIED` and activate the device — is not called from any route in this pack. A submitted enrollment proof today is accepted and then permanently stuck at `PENDING`. Do not present either path as "device enrollment works" until one of them is actually wired to a real proof verifier and completion route.
- **Durable outbox contract** (`client_message_state` table, web `messaging/ProductionMessagingCoordinator.ts` + `messaging/OutboxWorker.ts` + `storage/EncryptedLocalStore.ts` + `core/SecureCoreBridge.ts`): a real state machine (`DRAFT → ENCRYPTING → QUEUED → UPLOADING → ACCEPTED_BY_RELAY → DELIVERED/READ`, plus `FAILED_RETRYABLE`/`FAILED_PERMANENT`/`EXPIRED`) and the client-side orchestration to drive it. `FailClosedCoreBridge` and `FailClosedEncryptedLocalStore` are the only implementations supplied — no real encrypted IndexedDB store and no WASM core binding exist, so `ProductionMessagingCoordinator` cannot actually send or receive anything yet. It is applied and available but deliberately **not** wired in front of the working mock chat UI (see `docs/GAP_CLOSURE_APPLY_GUIDE.md`), matching how every other unfinished integration client in this repo has been handled.
- **LIVE-mode capability guard** (web `runtime/LiveCapabilityGuard.tsx`): a small component that blocks children in `LIVE` mode unless the named capability is `READY` in the runtime snapshot, and passes through unconditionally in `DEMO`/`HYBRID`. Wraps all three new pages in `App.tsx` using capability keys (`callsHistory`, `mediaGallery`, `privacyCenter`) that don't exist yet in `clients/web/src/runtime/features.ts` — so today, in the shipped `DEMO` default, the pages are reachable; the moment `VITE_LINQA_RUNTIME_MODE=LIVE` is set, they fail closed by design until those capability keys are added to the feature set and reported `READY`.

New Mobile Features + Next Mobile Features Addition (a new Expo Router client at `clients/mobile/`, plus server support — migrations `011_mobile_features.sql`, `012_next_mobile_features.sql`):
- **New mobile client** (`clients/mobile/`): no Expo/React Native project existed in this repo before these packs (Android/iOS are native Kotlin/Swift; only two standalone building-block files, `auth-flow.ts` and `SecureKeyStore.ts`, sat waiting for a host project). A minimal Expo Router scaffold (`package.json`, `app.json`, `babel.config.js`, `tsconfig.json`, root `Stack` layout, `(tabs)` layout) was created to host both packs' screens/components/services. See `docs/MOBILE_FEATURES_APPLY_GUIDE.md` and `docs/NEXT_MOBILE_FEATURES_APPLY_GUIDE.md` for what is and is not wired.
- **Calls tab, search, Quick Create, scheduled calls** (`app/(tabs)/calls.tsx`, `app/search.tsx`, `components/QuickCreateSheet.tsx`, `POST /v1/status`, `POST /v1/calls/scheduled`): a real, reachable calls history + scheduling UI. `QuickCreateSheet` is wired to a new plus button in the Calls header (no Home screen exists in this client for the "top-right plus button" the apply guide assumed).
- **Status/stories, message requests, media gallery, Privacy Center, device alerts, storage summary** (`app/status/[statusId].tsx`, `app/message-requests.tsx`, `app/(tabs)/media.tsx`, `app/privacy-center.tsx`, `GET /v1/security/device-alerts`, `GET /v1/storage/summary`): reachable screens for each, all querying real new server tables (`message_requests`, `status_reactions`, `status_replies`, `device_security_alerts`, `storage_usage_snapshots`) rather than mock data.
- **Settings screens** (`app/settings/{notifications,accessibility,storage,ai-privacy}.tsx`): reachable, but every toggle is local `useState` only — nothing persists server-side; see `docs/production-checklist.md`.
- **Duplicate status/stories concept**: this pack's `user_status_posts` table (rich: `content_type`/`content_ciphertext`/`privacy`/`custom_audience_user_ids`, i.e. an actually-encrypted status post) was applied alongside a separate, pre-existing `user_status_updates` table (from a concurrent, unrelated change to this repo — `010_mobile_hub.sql`/`routes/mobile-hub.ts`: plain-text `body`, no privacy/audience concept, seeded dev-only data). These are two different, overlapping implementations of the same "status" feature that now coexist with no relationship to each other. Not merged — that is a product decision, not a bug fix — but flagged here and in `docs/production-checklist.md` so it isn't mistaken for one system.
- **A genuine bug fixed**: every screen in both packs read the access token via `globalThis.localStorage?.getItem("linqa.access.token")` — React Native has no `localStorage` global (that is a browser API), so this always evaluated to `undefined` and every authenticated call would always throw "Authentication required." Fixed by replacing it with an explicit `FailClosedAccessTokenProvider` (`clients/mobile/services/session.ts`) that fails closed for an honest reason (no real secure session store exists yet) instead of a silently-wrong one.
- **The recurring `try`/`catch` and unguarded-optional-`deviceId` bug pair** (see bug #3 in "Bugs found and fixed" below) appeared again in both `routes/mobile-features.ts` and `routes/next-mobile-features.ts` — fixed before merging, same as the milestone/execution-launch/gap-closure packs.
- **Migration renumbering**: both packs shipped their migration as `010_*.sql`; the actual next-available number was already taken by a concurrent change (`010_mobile_hub.sql`). Renumbered to `011_mobile_features.sql` and `012_next_mobile_features.sql` respectively — table/column contents are otherwise applied exactly as supplied.

## Gaps filled that weren't in the supplied pack

Several files reference server endpoints or config values the pack never
actually shipped. Left as-is, these would make entire features permanently
unreachable rather than "not yet configured" (a meaningfully different,
worse state). Added:

- `routes/calls.ts`, `routes/recorded-videos.ts`, `realtime/signaling.register.ts` — the APPLY_GUIDE for stages 11–15/16–20 explicitly says to register call/location/recorded-video/signaling routes; only the underlying services were supplied.
- `routes/privacy.ts`, `routes/entitlements.ts`, `services/privacy-settings.service.ts` — the shipped web `PrivacySettingsClient` and `EntitlementClient` call `PUT /v1/privacy/settings` and `GET /v1/entitlements`; no server-side route or privacy-settings service existed for either.
- `routes/protocol-capability.ts`, `routes/feature-flags.ts` — same "register services" gap as above, this time for `ProtocolCapabilityService` and `FeatureFlagService`.
- `CONTACT_DISCOVERY_SECRET` config value (`config.ts`, `.env.example`) — `ContactDiscoveryService` requires an HMAC secret; the pack never defined where it comes from.
- `services/storage/fail-closed-object-storage.ts`, `services/push/fail-closed-push-provider.ts` — `AttachmentService`/`PushService` need concrete `ObjectStorage`/`PushProvider`/`TokenVault` implementations to be constructible at all; none were supplied (real S3/APNs/FCM/KMS integration is explicitly deferred). These fail closed rather than faking success.
- `community_memberships` table (`db/migrations/008_execution_launch.sql`) — `CommunityService.create()` inserts the owner into this table in the same transaction as the community itself, but neither milestone pack's migration ever created it; every community creation would have failed with an undefined-table error. Added, matching the `community_channels` table's own `MEMBERS`-visibility concept that already assumed membership existed.
- `try`/`catch` around every handler in `routes/milestone-platform.ts` and `routes/execution-launch.ts`, plus a `principal.deviceId` presence check in the collaboration-events handler — same two bug classes as bug #3 below, caught before merging this time instead of after.
- `try`/`catch` around every handler in `routes/gap-closure.ts`, plus a `principal.deviceId` presence check in the device-enrollment handler (the third occurrence of this exact bug pair in this session's packs — see bug #3 below and the milestone-platform entry above) — also caught before merging.
- `try`/`catch` around every handler in `routes/mobile-features.ts` and `routes/next-mobile-features.ts`, plus a `principal.deviceId` presence check in the status-publish handler (the fourth occurrence of this exact bug pair) — also caught before merging.
- `FailClosedAccessTokenProvider` (`clients/mobile/services/session.ts`) — every screen in both mobile packs read the access token via `globalThis.localStorage?.getItem(...)`, a browser-only API that does not exist in React Native; every authenticated call would always throw for the wrong reason. See "New Mobile Features" above.

## Bugs found and fixed while verifying against a live server

These existed in the code as originally supplied and were caught only by
actually running requests against it, not by typechecking:

1. `POST /v1/auth/challenges` never returned the `challengeId` it generated — no client could ever reach `/v1/auth/challenges/verify` without it. Now returned (it doesn't reveal account existence, so this doesn't weaken the anti-enumeration response).
2. `@fastify/websocket` resets the app's error handler during its own Fastify/avvio boot sequence if `app.setErrorHandler(...)` is called *after* `app.register(websocket)` in code — even though the registration is `await`ed. Errors were falling through to Fastify's default handler, which leaked internal error messages (e.g. `"missing bearer token"`) in 500 responses. Fixed by moving `setErrorHandler` before all plugin registration in `app.ts`.
3. Several route handlers (`routes/enrollment.ts`, `routes/auth.ts`, `routes/safety.ts`, `routes/sync.ts`, `services/push.service.ts`) called functions that throw on invalid input (wrong OTP code, missing bearer token, malformed phone number, `exactOptionalPropertyTypes` violations from spreading `undefined` into optional fields) without a surrounding `try/catch` or with a type error that would have blocked the build entirely. Fixed to match the try/catch pattern already used in `routes/relay.ts` / `routes/key-packages.ts`.
4. `GET /health/ready` queried `SELECT count(*)::int AS count FROM schema_migrations` to report readiness, but no migration file and no code path in `db/migrate.ts` (which just replays every `src/db/migrations/*.sql` file in order — it doesn't track applied migrations in a table) ever creates that table. The query always threw, so the endpoint reported `503 not-ready` even against a fully healthy, fully-migrated database. Fixed to report ready based on DB connectivity (`SELECT 1`) only, matching `GET /v1/runtime/capabilities`'s readiness check.
5. Postgres 18's official image changed its expected volume-mount layout: mounting the data volume at `/var/lib/postgresql/data` (the pre-18 convention, and what this repo's `docker-compose.yml` originally did) makes the `postgres:18-alpine` container refuse to start ("Error: in 18+, these Docker images are configured to store database data in a format which is compatible with pg_ctlcluster..."). Fixed by mounting at `/var/lib/postgresql` instead, letting the image lay out its own version-specific subdirectory. The same fix was applied to `vertical-slice/docker-compose.yml`.
6. `GET /v1/runtime/final-readiness`'s `checks.migrations` had the exact same bug as #4 above — it queried the nonexistent `schema_migrations` table too, so it silently always evaluated to `false` (masked in observable behavior by `secureCoreRequired` also always being `false`, but a real bug regardless: it would have stayed permanently wrong even once `secureCoreRequired` is eventually made real). Fixed to check for the newest migration's own table (`to_regclass('public.scim_directory_users')`) instead.
7. `.github/workflows/milestone-release.yml` ran `npm test` in `server/` with no Postgres service at all — every run would have failed on the first real-database test (`src/tests/relay.integration.test.ts`, `auth-security.test.ts`). Added the same `postgres:18-alpine` service block already used by `ci.yml` and `execution-launch.yml`, plus a `db:migrate` step before `npm test`.
8. `clients/web/src/pages/{CallsPage,MediaGalleryPage,PrivacyCenterPage}.tsx` as supplied had no `.catch()` on their fetch chains. Two effects: an unhandled promise rejection on every fetch failure (auth error, network error, server down), and — specifically in `PrivacyCenterPage` — a permanently stuck "Loading Privacy Center…" state, since the component only ever renders that message while `data === null` and nothing would ever set `data` on failure. Fixed all three to catch fetch failures into an error state and render it instead of failing silently or hanging.

## Running locally

```bash
cp .env.example .env   # then replace JWT_HS256_SECRET and CONTACT_DISCOVERY_SECRET with real random bytes
docker compose up -d postgres
npm install
npm run db:migrate     # applies every file in src/db/migrations, in order (12 as of the mobile feature packs)
npm run dev
```

`docker-compose.yml` runs `postgres:18-alpine`. If port 5432 (Postgres) or
8080 (the app) is already taken by something else on your machine, set
`LINQA_DATABASE_PORT`/`LINQA_API_PORT` (see `README_INTEGRATION.md`) instead
of editing the shipped defaults — both conflicts happened in this
environment (a pre-existing native Postgres install, and an OS-level
reservation on 8080) and are common local dev conflicts, not something to
"fix" in the shipped defaults.

No SMS/email provider is configured (`services/delivery/dev-console.provider.ts`
logs OTP codes to the console and refuses to run when `NODE_ENV=production`)
— replace it with a real provider before deploying.

## Structure

```
server/
├── src/
│   ├── app.ts, index.ts, config.ts
│   ├── auth/            # JWT verification, OTP, tokens, identifier normalization
│   ├── db/               # pool, migrate.ts, migrations/001-006*.sql
│   ├── ops/               # security-event (audit + user notifications)
│   ├── passkeys/           # WebAuthn integration boundary (not implemented)
│   ├── realtime/            # WebSocket hub, envelope-available + call-signaling registration
│   ├── repositories/         # device, key-package, relay (SQL access)
│   ├── routes/                 # relay, key-packages, enrollment, auth, attachments, sync,
│   │                              account-deletion, calls, recorded-videos, push,
│   │                              contact-discovery, safety, usernames, privacy,
│   │                              entitlements, protocol-capability, feature-flags
│   ├── security/                 # hash helpers
│   ├── services/                  # one per table/domain — see README sections above;
│   │   ├── delivery/                #  dev-console OTP provider (fails closed in production)
│   │   ├── storage/                  #  fail-closed ObjectStorage stub
│   │   └── push/                      #  fail-closed PushProvider/TokenVault stubs
│   ├── jobs/                            # cleanup, retention-cleanup, retention.worker,
│   │                                       account-deletion.worker, push-cleanup,
│   │                                       disappearing-message-cleanup — run on a schedule
│   └── tests/
├── docker-compose.yml
└── .env.example
```

See `docs/production-checklist.md` before considering any part of this
production-ready.
