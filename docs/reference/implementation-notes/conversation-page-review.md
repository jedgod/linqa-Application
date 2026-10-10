# Conversation page integration review

Reviewed the live Expo conversation implementation against `linqa-conversation-v2` and `Linqa_Conversation_Thread`.

## Source mapping

| Supplied code | Live implementation | Status |
| --- | --- | --- |
| `linqa-conversation-v2/convo_files/*` | `clients/mobile/components/conversation/*`, `services/conversation-{types,state,gate}.ts` | Adapted screen, composer, history, retry, and encryption gate |
| `linqa-conversation-v2/mobile/ConversationScreen.jsx`, `shared/engine.mjs` | `components/conversation/ConversationScreen.tsx`, `services/conversation-engine.ts` | Themes and decisions adapted; All/Plans/Ideas tabs now connected to filtering and outgoing text lanes |
| `Linqa_Conversation_Thread/conversation/ThreadSheet.tsx` | `components/conversation/AddSheet.tsx`, `SettingsView.tsx` | Twelve actions, feature toggles, backgrounds, block/unblock |
| Encrypted Attachments pack | `services/conversation.service.ts`, `server/src/chat/thread-attachment.*` | Event/Meeting sealed sends and history adapted; capture actions remain unavailable |
| Capture Access / Live Screen pack | `services/conversation-access.ts`, `capture-activation.ts`, `server/src/chat/live-screen.*` | Permission contracts and signaling exist; device capture and stream UI are still missing |

## Wiring corrections

- Chats opens the authenticated conversation instead of substituting the sample preview in development. Preview remains a separate development-only route.
- New chat opens the conversation ID returned by the existing mobile-hub API, with duplicate-submit protection and visible contact-loading/errors.
- Chats reloads on focus; stale inbox requests are ignored and account changes remount its state.
- Opening a chat does not issue a read receipt before the thread's encryption gate checks availability.
- Add to chat opens even when encryption is unavailable; its actions explain why sending cannot run. Poll, Event, and Meeting require live secure messaging.
- Poll and Event/Meeting forms guard duplicate submission and display failures. Date/time fields allow separators on Android.
- All/Plans/Ideas filter the decrypted timeline and set the selected lane inside outgoing encrypted text. Locking returns to All so sealed messages are not hidden by a topic filter.

## Remaining gaps

The source folders are integration packs, not complete drop-in applications. Their Express/lc2 storage and adapter interfaces differ from the live Fastify/canonical chat APIs. No parallel conversation database or plaintext fallback was introduced.

Document picking, AI images, location/contact capture and screen streaming still need concrete device/provider adapters and page integration. Photos, crop, voice and native video capture are wired as described below. Thread deletion currently shows an unavailable notice, and the live route supplies no derived safety number. The reference header's audio/video buttons now use the existing call service after a call confirmation; actual call delivery was not tested. The Chats create menu also routes New group to Connections, Broadcast to Status and Scan QR to Linked Devices rather than dedicated implementations of those named actions.

Expo Go does not contain the custom LinqaSecureCore native module. Real encrypted messaging stays locked there; a native build and functioning server capabilities are required for actual sends. Device sign-in and enrollment completed on the Galaxy A03s. The authenticated Jerry Mensah thread and its twelve-action Add menu were opened on the phone; sending remains disabled by the encryption gate.

## Validation

The live conversation engine/thread/card/capture suite passed 57 tests, the supplied v2 suite passed 13 tests, and mobile TypeScript checks passed. Physical-device checks confirmed authenticated navigation and the Add menu. These checks do not establish secure-send, capture, or call-provider readiness.

## Screenshot alignment

The conversation now follows the supplied reference: avatar/name header, circular black call buttons, green overflow menu, light gray thread, dark green outgoing bubbles, failed-message Retry/Delete controls, and a rounded composer with circled Add, topic, microphone, and video controls. The composer topic button is replaced by the requested emoji/tools menu. Local drafts and capture are available while sealed, but sending and opening history remain gated. The real Jerry thread has no message history, so reference sample messages were not inserted into the authenticated conversation.

## Composer controls update

The circled plus opens Add. The square emoji button opens an emoji grid and GIF/AI/Edit/Search/Select. Edit focuses the local draft; Search filters opened text/card titles; Select copies selected opened text through the system clipboard. GIF opens the device image library and requires a GIF. AI has no configured confidential provider and explicitly reports that no messages were sent to AI. Photos and crop now open native pickers. Voice records AAC with start/stop, preview and discard; video uses an in-app camera with start/stop, camera flip and preview. Capture is available in Expo Go, while Send still requires the secure core.

Media is encrypted once with XChaCha20-Poly1305 and a fresh random file key; the existing native secure core encrypts the key and descriptor for recipients. The file is uploaded to authenticated conversation-member routes, and referenced by an encrypted descriptor. History loads descriptors only; files are opened on demand. Local paths are excluded from transmitted and parsed incoming descriptors. Retry reuses encrypted media bytes. Cache files are cleaned on discard, gate lock or unmount. Limits: 60-second voice, 30-second in-app video at 480p, 8 MB original file, 8 MB plus encryption overhead per encrypted file and 128 MB encrypted storage per account. Migrations 057/058 add local encrypted media storage.

Validation: 63 conversation tests and 11 database integration tests passed; mobile/server TypeScript checks passed after the encryption/codec changes. Galaxy A03s checks opened the emoji menu and microphone recorder, created and played back a voice preview, and opened Samsung video capture. Samsung camera handoff reported a file-write error and was replaced by the in-app camera. Completed in-app video capture and encrypted delivery to a recipient are being verified separately.

The Windows native rebuild initially failed because Ninja could not see long prefab dependency paths. A persistent root Gradle staging-directory fix replaces dependency-local modifications that npm had overwritten. The rebuilt standalone APK is being verified separately; Expo Go cannot contain LinqaSecureCore.
