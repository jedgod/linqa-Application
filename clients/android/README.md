# Linqa Android Client

Native Android client for Linqa.

## Status

**Real backend-connected client, native crypto core not yet linked.** Builds with Gradle 8.13 (`assembleDebug` confirmed working) and Android Studio's bundled JDK 21; verified running end-to-end on a physical device.

- `network/RealApiClient.kt` is a genuine authenticated HTTP client (JWT bearer, transparent access-token refresh via `/v1/auth/sessions/refresh`) used by every real feature below — this is not a stub.
- Login (`AuthApi`), device enrollment (`EnrollmentApi`, real Ed25519 challenge-response matching `server/src/auth/enrollment-proof.ts` byte-for-byte), key-package publishing/resolution for calls (`KeyPackageApi`), multi-account phone verification and account switching (`MultiAccountApi`, the real `/v5/*` routes), and CountryLinqa discovery/community features (`CountryLinqaApi`, the real `/v1/countrylinqa/*` routes) are all wired to the live server, not fixtures.
- Calling (`calls/`) uses real WebRTC (`WebRtcClient`, `CallSession`, `SignalingClient`, `CallForegroundService`) with signaling payloads encrypted via `crypto/SignalingCrypto.kt`.
- Conversation list, chat, and status/media/community summaries (`crypto/CoreBridge.kt`) read and write through the server's `/v1/dev/mobile-hub` route — a real Postgres-backed endpoint, but one fixed to a single seeded demo user and hard-disabled outside development (`if (config.NODE_ENV === "production") return;` in `server/src/routes/mobile-hub.ts`). This is scaffolding for the conversation/message surface until the Rust core (below) is linked and per-user E2E sync replaces it — it is not in-memory mock data.
- Rust core (`linqa-core`) is not yet compiled for Android (requires NDK + UniFFI) — no native library is linked, so message content itself is not yet end-to-end encrypted client-side. This is the one real remaining blocker; everything else in this list is genuinely live.

## Architecture

```
android/
├── app/
│   └── src/main/
│       ├── java/com/linqa/app/
│       │   ├── ui/          # Jetpack Compose screens, theme, shared components
│       │   ├── crypto/      # CoreBridge (dev/mobile-hub) + device/signaling crypto; linqa-core wrappers pending UniFFI
│       │   ├── network/     # RealApiClient + per-feature API classes (auth, enrollment, multi-account, calls, countrylinqa, ...)
│       │   ├── account/     # Per-installation identity for the multi-account vertical
│       │   ├── calls/       # WebRTC session/signaling/foreground-service
│       │   ├── auth/        # Session storage
│       │   ├── model/       # UI-facing data classes
│       │   └── util/        # Formatting helpers
│       ├── res/
│       └── AndroidManifest.xml
├── gradle/
└── README.md
```

## Dependencies

- Kotlin + Jetpack Compose, OkHttp (REST + the dev-hub WebSocket), the WebRTC Android AAR (real calling)
- linqa-core via UniFFI-generated Kotlin bindings — planned, not yet linked (see below)

## Integration with Rust Core (remaining work)

1. Build `linqa-core` as a shared library (`cdylib`) for Android ABIs (`arm64-v8a`, `armeabi-v7a`, `x86_64`).
2. Generate Kotlin bindings from `core/uniffi/linqa_core.udl`.
3. Place generated code under `app/src/main/java/com/linqa/` (or a dedicated `generated/` module).
4. Load the native library in `LinqaApplication.onCreate()` (see its `TODO`s) and call into the core for message-level E2E crypto, replacing `crypto/CoreBridge.kt`'s dev/mobile-hub reads/writes with real per-user encrypted sync.

## Current Blockers

- Rust toolchain + Android NDK not set up for this client yet, so `linqa-core` isn't linked
- Real OpenMLS + hybrid PQC provider not implemented
- Conversation/message data is therefore still served through the single-demo-user `/v1/dev/mobile-hub` bridge rather than real per-user E2E sync (see Status above)

See the top-level `docs/` and `core/uniffi/` for the shared design.
