# Linqa conversation features

Documents (view, edit, mark up, save), attachments, AI images, location,
contacts, polls, events, meetings, voice and video messages, and live calls
with screen sharing and a shared whiteboard. Everything plugs into the
conversation page and its existing LIVE/LOCKED gate.

## How it stays end-to-end encrypted

| What | How it travels |
|---|---|
| Polls, votes, events, RSVPs, meetings, locations, contacts | A JSON `MessageContent`, encrypted by MLS like a text message (`content/codec.ts`). |
| Photos, documents, voice, video | Encrypted on the phone with a fresh per-file key, uploaded as ciphertext. The key travels inside the MLS message. The download is checked with SHA-256 after decrypting (`attachments/AttachmentService.ts`). |
| Calls, screen share, whiteboard | WebRTC media and data channel (DTLS-SRTP, keys negotiated between the phones). The offer and answer, which carry the DTLS fingerprints, are sent only as MLS-encrypted `rtc_signal` messages, so the server and TURN relays can't step in the middle. |
| AI image prompts | **Not** end-to-end encrypted. The prompt must reach the image service. The feature is off by default, asks for consent once, warns every time, and labels the result. |

If the secure core isn't available, `AttachmentService` throws
`CRYPTO_UNAVAILABLE` and `useAttachFlow` won't open the menu. Nothing goes
out in plaintext.

## Folder map

```
content/        types.ts (every message type), codec.ts (strict encode/decode)
attachments/    AttachmentService.ts (encrypt/upload/download/verify/save), pickers.ts
documents/      DocumentViewer (image zoom, PDF, video, voice, text), TextDocumentEditor,
                ImageEditor (crop/rotate/flip), MarkupEditor (draw over a photo), cropMath.ts
features/       polls/, schedule/ (events + meetings + calendar + reminders),
                location/, contact/, ai/, voice/
whiteboard/     model.ts (shared board state), geometry.ts (zoom/pan/hit test),
                WhiteboardCanvas.tsx, WhiteboardToolbar.tsx
live/           LiveSession.ts (WebRTC), useSharedBoards.ts, LiveSessionScreen.tsx
attach/         AttachSheet.tsx (the + menu), useAttachFlow.tsx (menu -> composer -> send)
render/         threadIndex.ts (folds votes/RSVPs/session ends), ContentBubble.tsx
ui/             tokens.ts, Form.tsx
__tests__/      logic.test.ts
```

## Whiteboard features

Pen, highlighter, eraser, rectangle, circle, line, arrow, text, sticky notes,
select/move/recolor/delete, marquee select, laser pointer, live cursors,
undo/redo of your own actions, pinch zoom (10% to 800%), two-finger pan,
zoom buttons, fit to screen, dot grid, "Only I draw" lock, clear mine or
clear all, and save to chat as an encrypted PNG. The same canvas also handles
annotating over a shared screen and marking up photos.

Concurrent edits converge: each element carries a Lamport clock and the
newest edit wins everywhere. A delete that arrives before its element still
wins. Peers can't create elements as someone else, and every incoming op is
validated and size-limited.

## Wiring it into the conversation page

1. **Send path.** Implement `ContentTransport.sendContent` with your
   `ConversationService`: `encodeContent(content)`, then the same MLS encrypt
   and send you use for text.
2. **Receive path.** After `decryptServerRows`, run `decodeContent` on each
   plaintext. `null` means show "Can't open this message". Route
   `rtc_signal` to the active `LiveSession.handleSignal`.
3. **Fold, then render.** Build `indexThread(allDecrypted)` from every
   decrypted message, before hiding anything. Render `index.visible`, pass the
   same `index` to each `<ContentBubble>`, and count unread with
   `index.unreadEligible`. Votes and RSVPs are separate hidden messages; the
   index groups them by `pollId` and `eventId` so the cards update when a
   new one arrives. Filtering hidden types first would leave every poll at
   zero (there's a test for exactly that).
4. **Attach.** Call `useAttachFlow(...)`, render `{flow.overlays}` once, and
   point the composer's + button at `flow.open()`. Feature toggles come from
   Conversation settings (`ChatFeatures`).
5. **Calls.** Create a `LiveSession`, call `start()`, send a
   `live_session` "started" message, and show `LiveSessionScreen`. Send
   "ended" when it closes.
6. **Wipe.** Call `attachments.wipeOpened()` when the app goes to the
   background and when leaving a conversation.

## Native work still needed

- **linqa-core:** implement `NativeFileCrypto` (`encryptFile`,
  `decryptFile`, `sha256File`) as streaming AEAD (XChaCha20-Poly1305 or
  AES-256-GCM in chunks), and expose it next to `MessageCrypto` through
  UniFFI.
- **Blob server:** implement `BlobStore` (upload/download of ciphertext).
  Use short-lived URLs.
- **TURN server:** pass `iceServers` with short-lived credentials (coturn
  with the REST auth secret works well).
- **Screen sharing:** on Android, add a foreground service with type
  `mediaProjection` (react-native-webrtc documents this). On iOS,
  sharing outside the app needs a Broadcast Upload Extension and an App
  Group. Without it, only the Linqa app itself can be shared.
- **AI images:** implement `AiImageProvider` against your image service.
  Store the consent flag per user.
- **Permissions (app.json):** camera, microphone, photo library, location
  (when in use), contacts, calendar, notifications.

## Dependencies (Expo SDK 53)

```
npx expo install expo-file-system expo-sharing expo-media-library expo-document-picker \
  expo-image-picker expo-image-manipulator expo-location expo-contacts expo-calendar \
  expo-notifications expo-audio expo-video @react-native-community/datetimepicker \
  react-native-svg react-native-gesture-handler react-native-view-shot
npm i react-native-webrtc react-native-pdf react-native-blob-util
```

react-native-webrtc and react-native-pdf need a development build, not Expo Go.

## Checks

- `npx tsx --test __tests__/*.test.ts`: 22 tests. `logic.test.ts` covers the codec
  (round trips and rejection of malformed input), poll tallying, RSVPs,
  meeting join windows, whiteboard convergence, out-of-order deletes,
  undo/redo, impersonation and lock enforcement, zoom math, hit testing and
  crop geometry. `fold.test.ts` checks that later votes and RSVPs update
  the cards, that hidden messages stay out of the thread and unread count, and
  that the wrong wiring order fails. All pass.
- `tsc --strict` against React Native 0.79, Expo SDK 53 and the libraries
  above: no errors.
- Not yet run on a device. The UI, gestures, WebRTC and native pickers need
  testing on real phones.
