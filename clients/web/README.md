# Linqa Web Client

Progressive Web App (PWA) client for Linqa.

## Status

**UI shell with mock data.** Buildable and runnable (`npm install && npm run dev`), but not connected to real cryptography yet.

- Conversation list, chat view, and settings/device-management UI are functional against in-memory mock data (`src/mock/data.ts`)
- `src/services/CoreBridge.ts` mirrors the async API the real WASM bridge will expose, so swapping in the real core later shouldn't require UI changes
- **Security-runtime honesty layer**: `useSecurityRuntime()` + `SecurityStatusBanner` report an explicit `SecurityRuntimeState` (`demo` / `loading` / `unavailable` / `failed` / `ready`). The UI only shows "End-to-end encrypted" or "Post-quantum encryption active" when `state.kind === "ready"` — since no real core is wired in yet, it always honestly shows a demo/not-encrypted banner and labels instead. `npm test` runs `src/services/CoreBridge.test.ts`, which asserts this fail-closed behavior (demo state is never labeled encrypted; the WASM adapter never reports a successful send while unavailable).
- Mobile single-pane responsive layout (`src/styles/responsive-hardening.css`) — below 720px width the sidebar and chat view stack as separate panes with a back button, instead of a fixed two-column desktop grid
- Feature-limited by design (web crypto and storage constraints)
- No real connection to linqa-core yet (would require WASM build of the core)
- **Runtime capability wiring** (`src/runtime/`): `main.tsx` mounts `AppIntegrationShell`, which wraps the whole app in `LinqaRuntimeProvider` + `RuntimeStatusBanner`. `RuntimeController` resolves a DEMO / HYBRID / LIVE `RuntimeSnapshot` per stage (1–30) from server/core/auth probes, failing closed to DEMO or a disabled capability rather than assuming readiness. `CapabilityGate` conditionally renders feature UI against that snapshot; `RuntimeRouteGuard` + `UnavailableCapabilityPage` do the same for routes. See `docs/production-checklist-addendum.md`.
- **Calls / Media / Privacy Center pages, mounted and reachable**: `App.tsx` renders `pages/CallsPage.tsx`, `pages/MediaGalleryPage.tsx`, and `pages/PrivacyCenterPage.tsx` as overlays opened from three new `Sidebar` icon buttons, each wrapped in `runtime/LiveCapabilityGuard.tsx` (fails closed in LIVE mode for the `callsHistory`/`mediaGallery`/`privacyCenter` capability keys, which don't exist yet in `runtime/features.ts` — passes through unconditionally in the shipped DEMO/HYBRID default). This closes the `claudeassess.txt` findings "Calls Tab - ABSENT" and "Media Gallery - ABSENT" at the reachability level; both pages fetch real server data (`GET /v1/calls/history`, `GET /v1/media`) and will correctly show empty state against a real backend, since nothing yet writes rows into `call_history`/`media_index` from the actual call/attachment pipelines. `PrivacyCenterPage` fetches `GET /v1/privacy-center`, which aggregates genuinely real devices/sessions/blocks/privacy-settings data — this is not mock data.
- **Durable outbox / production messaging scaffold** (`src/core/SecureCoreBridge.ts`, `src/storage/EncryptedLocalStore.ts`, `src/messaging/ProductionMessagingCoordinator.ts`, `src/messaging/OutboxWorker.ts`): a real encrypted-send/receive state machine and orchestration class exist, but only fail-closed stub implementations of the core bridge and local store are supplied (no WASM core, no real encrypted IndexedDB). Deliberately **not** wired in front of the working mock chat send in `ChatView`/`App.tsx` — doing so would put a guaranteed-to-throw path in front of the one thing that currently works. See `docs/GAP_CLOSURE_APPLY_GUIDE.md`.

### Server integration modules (present, not wired into the live UI)

`src/services/RelayClient.ts`, `RealtimeClient.ts`, and `SecureMessagingService.ts`
talk to the real `server/` (Postgres-backed relay + WebSocket notifications).
`src/services/AuthClient.ts`, `src/hooks/usePasswordlessAuth.ts`, and
`src/components/UnifiedAuthForm.tsx` implement the phone/email OTP login flow
against `server/src/routes/auth.ts`. None of these are mounted in `App.tsx` —
they require a running server and a real `CryptoCore` (WASM) implementation
to be meaningful, and wiring an auth wall in front of the working mock demo
would just break it. Treat them as ready-to-integrate building blocks once
those exist. (One bug already fixed while building these: `AuthClient.requestCode`
originally discarded the `challengeId` the server returns — without it,
`verifyCode` could never be reached. Fixed here and in `server/src/routes/auth.ts`.)

Stages 6–30 add many more such building blocks, all in the same
not-yet-mounted state, matching their `server/` counterparts one-for-one:
`services/AttachmentClient.ts` + `services/SyncEngine.ts` (attachments/sync),
`calls/` (`AuthenticatedSignalingClient`, `WebRtcPrivacyController`,
`TeleprompterController`, `RecordedVideoDisclosure`), `location/`
(`LocationExchangeService`, `LocationPrivacy` — consent + precision
reduction), `contacts/ContactDiscoveryClient.ts`, `push/PushRegistrationClient.ts`,
`safety/SafetyClient.ts`, `billing/EntitlementClient.ts`,
`messages/DisappearingMessageController.ts`, `native/SecureCoreAdapter.ts`
(the intended FFI entry point once `core::ffi::FfiCore` is bound to WASM),
`privacy/PrivacySettingsClient.ts`, and `voice/VoiceNoteRecorder.ts`. See
`server/README.md` for which server-side routes these actually call, and its
"Gaps filled" section for the handful of endpoints (`/v1/privacy/settings`,
`/v1/entitlements`) these clients expected that the server pack never shipped
and had to be added.

The three-milestones and milestone-execution-launch packs add the same
not-yet-mounted building blocks for Linqa 2.0/3.0: `ai/PrivacyAwareAiClient.ts`,
`collaboration/ScreenShareController.ts`, `enterprise/EnterprisePolicyClient.ts`,
`milestones/MilestoneFeatureGate.tsx`, `admin/ReleasePromotionClient.ts` +
`admin/MilestoneLaunchDashboard.tsx` (release-admin-only, per
`docs/EXECUTION_AND_LAUNCH_APPLY_GUIDE.md` — never mount this in the
end-user app), `business/BusinessProfileClient.ts`, and
`communities/CommunityClient.ts`.

**Video-call location: showing + acceptance.** The existing
`location/LocationExchangeService.ts` only ever *published* a device's own
encrypted location during a call — nothing let the other participant read
it back, so a shared location could never actually be shown. Added
`location/CallLocationReceiver.ts` (polls the new
`GET /v1/calls/:callId/location-events`, decrypts via a
`LocationDecryptionCore`) and `location/CallLocationBanner.tsx`, a small UI
component that requires an explicit "Show location" action
(`CallLocationReceiver.accept()`) before any decryption or display happens —
mirroring the sender-side `assertLocationConsent` gate in
`location/LocationPrivacy.ts`. Like the rest of this list, not yet mounted
into a live call UI.

## Planned Architecture

```
web/
├── public/                 # Static assets, manifest, icons
├── src/
│   ├── components/         # UI components (+ UnifiedAuthForm, SecurityStatusBanner)
│   ├── hooks/               # useSecurityRuntime, usePasswordlessAuth
│   ├── services/              # CoreBridge (mock/WASM), RelayClient, RealtimeClient,
│   │                            SecureMessagingService, AuthClient, AttachmentClient,
│   │                            SyncEngine
│   ├── calls/                   # signaling, WebRTC privacy, teleprompter, recorded-video disclosure
│   ├── location/                  # call location consent + precision reduction
│   ├── contacts/                    # private contact discovery
│   ├── push/                          # push registration
│   ├── safety/                          # block/report
│   ├── billing/                           # entitlement cache
│   ├── messages/                            # disappearing-message timers
│   ├── native/                                # FFI adapter boundary (SecureCoreAdapter)
│   ├── privacy/                                 # privacy settings
│   ├── voice/                                     # voice note recording
│   ├── styles/
│   ├── App.tsx / main.tsx
│   └── index.html
├── package.json
└── README.md
```

## Design Constraints (Security)

The web client is intentionally **feature-limited**:

- Prefer WebAssembly build of `linqa-core` rather than re-implementing crypto in JS
- Local storage must be encrypted (or avoided for high-sensitivity data)
- No long-term private keys left in easily extractable JS memory if avoidable
- Some advanced features (full multi-device, large groups, hardware-backed keys) may remain mobile/desktop-only
- Clear security warnings when the user is on the web client

## Integration with Rust Core

1. Compile `linqa-core` to WebAssembly (`wasm32-unknown-unknown` or `wasm-bindgen` / `wasm-pack`).
2. Expose a minimal JS/TS API (or use UniFFI WASM target if available).
3. All cryptographic operations go through the WASM module.

## Current Blockers

- No Rust → WASM build of linqa-core yet (`core::ffi::FfiCore` exists as the target surface — see `core/README.md` — but nothing generates bindings from it)
- Most of the server-integration modules listed above are still not mounted into the live UI — the runtime capability layer (`src/runtime/`) that *is* mounted (see "Status") governs whether/how they'd activate once they are, but doesn't mount them itself

See top-level `docs/` and `core/` for the shared design.
