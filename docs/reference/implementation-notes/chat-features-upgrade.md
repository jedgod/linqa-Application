# LinqaChat feature upgrade

The supplied `linqa-attachments+backend/linqa-features` package has been adapted to the live Expo SDK 57 / React Native 0.86 client. The original package remains unchanged. The integration is in `clients/mobile/features/conversation` and `components/conversation/useProductionFeatures.tsx`.

## Implemented behavior

| Feature | Integration and safeguards |
| --- | --- |
| Documents | Authenticated encrypted upload/download, private local opening, PDF and text viewing, text editing, explicit save/export. Edited versions preserve the original attachment. |
| Images | Existing capture/selection preview; crop, rotate, flip, markup, encrypted edited copies, temporary-output cleanup. |
| Voice and video | Existing permission and preview flows remain in use; playback and document viewer use SDK 57 audio/video APIs. |
| Location | Foreground permission, actual device coordinates, exact/approximate choice, encrypted content, external maps only after a tap. |
| Contacts | Native picker, explicit field selection, encrypted cards, explicit native save, permission-error handling. |
| Polls | Single/multiple choices, closing time, voter-display preference, latest-vote folding, encrypted votes, failed-vote retry without counting the failed vote. |
| Events | Start/end time, place/note, encrypted RSVP updates, writable-calendar selection, local reminders with hidden details by default. |
| Meetings | Time-bound joining, fresh call-attempt identifiers associated with a meeting, encrypted setup, private reminders. |
| AI images | Off in new chat preferences; explicit prompt-disclosure consent; authenticated member-only backend proxy; credentials remain on the backend; bounded, validated responses; selected images encrypted before chat transmission. |
| Live calls and screen sharing | Native WebRTC loaded on demand; authenticated TURN credential endpoint; relay-only ICE; encrypted setup messages; system screen-capture consent; timeout and lock/background/leave cleanup. Screen capture is enabled for Android only. |
| Whiteboard | Shared canvas, tools, selection, undo/redo, cursor/laser, drawing lock, encrypted data channel, bounded chunk assembly, identity and lock checks for full sync, reconnect tombstones, encrypted PNG snapshots. |

Feature messages are wrapped in the existing encrypted `Payload` transport and retain sealed bytes in the existing durable outbox. Their plaintext is not sent to the ordinary chat relay. AI prompts are an explicitly disclosed exception sent only to the configured image provider.

Files use XChaCha20-Poly1305 with fresh keys/nonces, conversation/blob/MIME associated data, and a verified plaintext hash and size. The current adapter buffers files and caps plaintext at **25 MB**. It does not implement the original pack's proposed Rust streaming interface or 100 MB support.

Opened files and generated/edited temporary outputs are cleaned on lock, background, leaving the conversation, or after sending. A late permission/decryption result cannot bypass a closed gate. System exports are explicit and leave Linqa's protection.

## Backend configuration

Apply existing conversation migrations, including `057_conversation_media.sql`, `058_conversation_media_limit.sql`, and the preceding contact-attachment upgrade's `062_chat_contact_attachments.sql`, through the normal migration process.

`GET /v2/chats/:id/features` advertises configured capabilities. `GET /v2/chats/:id/ice-servers` issues one-hour credentials only for a current, unblocked member. Configure a reachable `turn:` or `turns:` endpoint in `TURN_URLS` and the corresponding `TURN_SHARED_SECRET`; loopback-only configurations do not enable live features.

For AI, configure `CHAT_AI_IMAGE_URL` (HTTPS) and `CHAT_AI_IMAGE_TOKEN`. The trusted provider receives `{ "prompt": "...", "style": "Photo|Watercolor|Sketch|Diagram" }` and returns `{ "images": [{ "mime": "image/png|image/jpeg|image/webp", "base64": "..." }] }`, with 1–4 images. The proxy requires explicit consent, checks membership, limits requests and response size, rejects redirects, and does not expose provider errors or credentials. With no provider configured it returns unavailable rather than synthesizing results.

The native dependencies require a new binary. App/package/Android runtime are now **0.3.0**, Android version code **2**, so the app-version OTA policy does not deliver these native-module imports to the older runtime. Native permissions and MediaProjection configuration are in `app.json`, the checked Android sources, and `plugins/with-chat-features.cjs`. iOS needs a new native build; external iOS screen capture remains disabled until a Broadcast Upload Extension is implemented.

## Verification

Automated verification includes the supplied codec, poll, RSVP, meeting-window, crop, geometry and whiteboard tests; chat/capture/media regressions; descriptor and chunk limits; spoofed or locked sync; restart-safe feature delivery; failed-vote handling; call identity, ICE bounds, late permissions, hangup cleanup and timeouts; actual file cryptography with a mocked filesystem; picker cancellation; calendar permissions; private reminders; and authenticated backend provider routes.

At the recorded final run, **114 Node regression tests**, **89 backend chat tests**, and **12 native-adapter tests** passed (215 total). The backend run includes all 59 PostgreSQL-dependent tests, with no skips, after applying the full repository migrations to a disposable PostgreSQL 16 container. The container was removed afterward. Mobile typecheck, backend TypeScript build, Android JavaScript export, native config-plugin introspection, and the Android native build passed. Device startup is a separate check described below. An initial backend run during native compilation failed; subsequent backend runs passed, including the complete verification script and the isolated-database run.

Reproduce adapter checks from `server`: `npx vitest run --config vitest.chat-features.config.ts`. Backend checks: `npm run chat:test` and `npm run build`. Mobile checks: `npm run typecheck` and `npx expo export --platform android`.

Run `scripts/test-chat-features.ps1` for the complete automated verification. Android debug builds use Metro; `debuggableVariants` now consistently uses the debug variant. A device startup check exposed a native-library mismatch: the packaged `libreactnative.so` lacks the `DebugStringConvertible` vtable required by Expo, while the resolved debug React Native artifact exports it. This remained a startup failure after the first Metro build and prompted a clean app rebuild. Compilation alone must not be reported as a passed device startup check. Release builds continue to embed JavaScript and require the existing release-signing configuration. Installation on the Samsung test device failed due to insufficient storage; installation on the LG device succeeded without clearing app data.

The app's CMake arguments also forced `RelWithDebInfo` for debug builds. That override has been removed, and debug JNI debugging is enabled so AGP can select the matching native variant. The corrected ARM32 debug build passed (`tmp/chat-android-variant-build.log`), its packaged React Native library exports the required vtable, and it installed successfully on the LG device without clearing app data. Metro bundled 2,590 modules successfully. The app stayed alive and visibly rendered the session-recovery screen (`tmp/chat-device-final-ui.xml`); the existing account could not reconnect to the backend, so authenticated chat interactions remain unverified. No user messages were sent. Startup now shows a loading indicator and permits system fonts after eight seconds rather than waiting indefinitely for font assets. Metro's generated-native-output exclusion includes nested paths such as `android/app/build`; exclusion checks preserve conversation feature sources.

For USB debug testing, run `npx expo start --lan --port 8081` from `clients/mobile`, forward the device port with `adb -s <test-device> reverse tcp:8081 tcp:8081`, and build with `gradlew.bat :app:assembleDebug`. On this Windows host, `--localhost` bound only IPv6 and the USB forward could not reach it; a LAN listener with USB forwarding resolved connectivity. No deployment was performed. Release signing remains governed by the existing repository configuration.

Run `scripts/test-chat-feature-db.ps1` for isolated database verification. It requires Docker and a cached `postgres:16` image, creates a uniquely named disposable container bound to a random loopback port, supplies test-only configuration, applies the complete migration set, requires database tests, and removes the container and restores process environment variables in `finally`.

## Protected photos

A direct chat's "+" menu has **Protected photo**. The sender picks a photo and a rule, the app strips its metadata, encrypts it on the phone with a one-time key (XChaCha20-Poly1305) and uploads only the ciphertext to `POST /v1/protected-media`. The key goes to the recipient inside the end-to-end encrypted `protected_media` message, so the server never holds anything it can open.

Rules (validated again on the server, `server/src/protected-media/policy.ts`): limited views (1 to 10, every view logged), a time window (30 to 60 s, from sending or from first open), or view once/twice (a screenshot or screen recording ends access at once and alerts the sender). Each view needs a server-issued single-use token. The final allowed view, an expired window, a revoke or a capture wipes the ciphertext from the database.

The viewer asks Android for `FLAG_SECURE` through `expo-screen-capture`, which blocks screenshots and recordings on most devices, and detects screenshots. Screen recording is detected by the local `modules/screen-recording-detector` module on Android 15 and newer only; on older versions recordings are blocked rather than detected. iOS is not built or tested here. Recipients can still photograph the screen with another device; no app can prevent that.

Every step is written to a hash-chained audit log (`protected_media_audit`, HMAC keyed by `PROTECTED_MEDIA_AUDIT_SECRET`, or a key derived from `JWT_HS256_SECRET` when unset). The sender sees it from the bubble, with an integrity check that fails if any row is edited. The sender's bubble polls the status every five seconds; the server also pushes `protected-media.alert` to the sender's connected devices.

Limits of this build: one recipient (direct chats only), JPEG photos up to 15 MB of ciphertext, and the key stays in the message history of both people (harmless once the ciphertext is gone). Tests: `server/src/tests/protected-media.integration.test.ts`, which needs `DATABASE_URL`.

## Release gates

Automated tests and the verified LG debug startup do not certify every native interaction. A release still needs two-account device send/open/retry flows, real TURN media and screen capture, actual AI-provider generation, native picker/save/calendar/notification permission cases, background/lock handling, release-binary startup across supported architectures, and iOS native validation. The server cannot infer hidden-control unread eligibility from encrypted message content; the local thread filters those controls, while server-derived chat badges may still count them.

The dependency audit reported 26 advisories (23 high, 3 moderate), largely through Expo/React Native tooling and transitive packages. Suggested automatic fixes include incompatible SDK downgrades; they were not applied. Compatible dependency remediation is a separate release gate. The feature upgrade must not be described as fully production-certified until these checks and configuration requirements are satisfied.
