# Linqa chat composer + photo/video connections v1

Requested change: organize the composer from emoji/text through camera/video, provide Take photo / Record video / Choose from gallery, connect media upload backend using PostgreSQL and local SQLite. “AQLite” is interpreted as SQLite.

Status: implementation pack, not applied to the live repo. Provided screen and route text were reviewed. ComposerArea, CapturePanel, conversation-media, attachment crypto, auth and current server source were not supplied. Their APIs must be mapped; this pack cannot truthfully activate them remotely. Do not add the earlier durable-receive native scaffold. This change uses existing one-shot encrypted messages and existing outbox.

## Composer behavior
Left to right: Emoji -> Message/caption field -> + -> Photo/video menu -> Send (when text/media exists), otherwise existing Voice action. Indigo/violet surfaces with apricot controls; 44-point targets and multiline text. Media preview appears above input, photo thumbnail or Video label, optional caption and Remove. Camera menu includes Take photo, Record video and Choose from gallery. Plus can keep your existing Poll/Event/Meeting/Document sheet. No placeholder alerts for photo/video after connection.

## Dependencies / permissions
In clients/mobile run `npx expo install expo-image-picker expo-sqlite`. Use versions compatible with YOUR installed Expo SDK; no SDK upgrade is included here. ImagePicker MediaTypeOptions is used for older SDK compatibility; newer SDKs also support mediaTypes arrays. Add/merge expo-image-picker plugin with cameraPermission/photosPermission/microphonePermission strings and retain existing plugins. Configure Android camera and microphone permissions for recorded video as required by installed plugin. Rebuild the signed development app after native changes. Do not uninstall the installed app or replace its signing key; Expo Go is not evidence that the Linqa crypto bridge works.

Current API references:
https://docs.expo.dev/versions/latest/sdk/imagepicker/
https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/

## Replace the supplied screen's composer
Import ChatComposer and MediaDraft. Keep message state, outbox, calls and read receipts unchanged.

```tsx
<ChatComposer
 scopeKey={JSON.stringify([selfId, deviceId, conversationId])}
 enabled={c.gateState.mode === 'LIVE' && !blocked}
 onText={sendText}
 onMedia={(draft, caption) => mediaPipeline.prepare(
   {accountId:selfId,deviceId,chatId:conversationId}, draft, caption
 )}
 onAdd={() => setAddOpen(true)}
 onVoice={() => setCapture('VOICE')}
/>
```

`selfId`, `deviceId` and `mediaPipeline` must be actual props/context values. Resolve deviceId from your existing bound native installation, never default ''. Your reported lane fix stays as is. Keep the Voice CapturePanel until its existing handler is verified. Remove competing photo/video buttons or forward their handlers to the same capture flow so there is one menu. Keep onTools/search/settings accessible in your existing header/menu. ChatComposer is scoped: changing conversation/account/security state clears its text and media preview; callbacks returning for the old scope cannot repaint. Camera activity can temporarily background the app; test re-evaluation of gate on return. Do not restore a captured draft into a different account or still-locked scope.

## MediaPipeline connections
Initialize one pipeline per account/device scope with:
- queue: SqliteMediaQueue on the existing SQLite handle, after executing upload-queue.sql once in a versioned migration. This is a separate media-upload queue, NOT duplicate chat history or a new message outbox.
- crypto.encryptFile: map to existing audited attachment crypto. Read actual file bytes, validate photo/video content type, enforce max 25 MiB and video <=60 sec from actual media metadata (picker values are UX checks only). Produce app-private ciphertext file, SHA256 of ciphertext, ciphertext byte length and recipient decryption descriptor. Never return raw plaintext as ciphertext. Target attachment descriptor inside existing sealed message for every authorized recipient/self device.
- crypto.sealLocal/openLocal: use existing account/device protected local encryption for descriptor (contains caption and attachment key). No plaintext key/caption in SQLite. If absent, disable persistent media preparation until added; do not use the fake test crypto.
- files.readEncrypted: return bytes of the app-private encrypted file. files cleanup: remove owned encrypted files after existing outbox ACK/retention policy and on explicit discard. Never delete original gallery assets. A failure before queue insertion needs owned-file cleanup; add to existing conversation-media cleanup. Pipeline only owns prepared ciphertext, not picker URI.
- transport: mobile/transport.ts using existing authenticated session headers, with server-bound device authentication. Check session/account unchanged after every await in auth implementation.
- sendPayload(scope,payload,messageId): map to conversation.service's EXISTING encrypted send/outbox using stable messageId. If ID already queued/accepted, reuse the stored sealed envelope; NEVER re-seal the same ID. This must be an atomic idempotent ensure-queued operation to handle a crash after message enqueue but before media queue status update. Existing payload parser and MessageBubble must accept attachment reference via a typed mapping; `type:media/version:1` here is a reference schema, not proof your parser supports it.
- assertLive(scope): check current account, bound device, chat, gate generation and block status. If any mismatch/lock, throw before opening local descriptor, queueing or delivering decrypted media URI.
- newId: existing secure random UUID generator.

Restart/foreground: call queue.list(scope), resume each sequentially while LIVE. This reuses exact ciphertext, uploadId and messageId. Upload may have succeeded even if response was lost: PUT same ID is idempotent. If message outbox enqueue succeeded before status save, ensure-queued must recognize it. Show FAILED jobs with Discard, and uncertain jobs as waiting/retry. Disable discard while active; remove SQLite row and owned ciphertext only after coordination with existing message outbox. Attachments already referenced by a sent message must not be deleted by a draft discard.

Recipient: open encrypted message as before, pass mapped media payload to pipeline.receive, verify ciphertext digest and authenticated encryption inside crypto.decryptFile, then render private decrypted URI. Decrypted file cleanup must run on lock, navigation, account switch and TTL. Do not render an unverified server URL or trust MIME from server. Video playback should use the app's existing player module; the composer preview is a label and metadata, not an added untested player.

## Backend mounting
PostgreSQL stores upload IDs, ciphertext hashes, sizes and owner/chat scope. Attachment bytes live in private blob storage; they are not public HTTP files. Photos/videos/captions and key descriptors are encrypted on the client. Server cannot inspect MIME or scan plaintext. Blob size cap is 26 MiB to allow encryption overhead; crypto caps source to 25 MiB. Streaming/object-storage transport is recommended for large-scale operation; this reference buffers one bounded request in memory.

Apply server/postgres.sql in your next real migration, review canonical parent-ID normalization with repository maintainers. upload_id is UUID. account/device/chat columns are canonical text ONLY in this new opaque metadata table; existing authorization queries must use actual native schema IDs and not cast existing tables. Add project-specific FKs if compatible. The migration creates no chat_messages replacement.

```js
const repository = new PostgresMediaRepository(pool, {
 reserveQuotaAndVerifyMembership: async (tx, record) => {
   // REQUIRED mapping to real repository. In ONE transaction:
   // lock/check account + bound device + current chat membership/block state;
   // lock/reserve account's upload quota using record.byteLength;
   // throw on denial. Do not replace this with a no-op.
   await existingMediaPolicy.reserve(tx, record);
 }
});
const service = new MediaService({
 repository,
 blobs: new PrivateBlobStore(PRIVATE_BLOB_DIRECTORY),
 authorize: (scope, action) => existingChatPolicy.authorize(scope, action)
});
app.use(mediaRouter({express,service,authenticate,
 requireBoundDevice,uploadRateLimit}));
```

Both policies must enforce membership, block status, bound device and account revocation. Existing-auth middleware populates req.session; user IDs from body are ignored. Apply CSRF protections for cookie sessions and required CORS. Use existing rate limiting and request concurrency caps BEFORE raw parser. Place the router before any broad octet-stream body parser. global error handler handles parser 413 cleanly.

Routes follow existing /v1/chats namespace:
PUT /v1/chats/:id/media/:uploadId  (octet-stream + X-Ciphertext-SHA256)
GET /v1/chats/:id/media/:uploadId  (authenticated ciphertext)

Immutable file publication uses temporary file + fsync + link, protecting retries from partial file writes. Use persistent private volume. Blob publication and PostgreSQL commit are not a distributed atomic transaction: periodic orphan cleanup is REQUIRED for blobs whose DB insert failed; retain a grace period and avoid racing active uploads. Implement quota preflight plus post-publication transactional reservation; denied uploads can otherwise leave temporary storage pressure. For production, use existing private object storage and lifecycle/reconciliation workers. Do not delete uploaded media on restart. Define retention from referenced chat_messages through your actual payload/attachment metadata mapping before enabling automatic expiration. No unimplemented cleanup worker is claimed here.

## Validation and activation
Run `node --test tests/media.test.mjs`: 15 tests with actual SQLite and private file writes plus a fake client crypto adapter. No E2EE verification is claimed from mock crypto. Tests cover authorization, immutable ID collisions, hash/size checks, database restart, and encrypted queue flow contracts. PostgreSQL service uses parameterized queries and transaction hooks but Postgres integration tests have NOT run here. React/Expo typecheck and native compile have NOT run here.

Before activation in repo: map payload types; compile mobile; run repository checks; run PostgreSQL integration tests for concurrent retry/quota/revocation/rollback; then test Samsung camera permission denial/cancel/photo/video/gallery/preview/send/receive/offline/restart/account switch and a second receiving device. Keep existing signing certificate. Enable feature only after real attachment crypto and policies are connected. Until then disable media callbacks in UI rather than sending plaintext.
