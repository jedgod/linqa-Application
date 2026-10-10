# Photo/Video connected pack v1.2

Read this first. Includes selected-mode popup UI, encrypted upload pipeline, PostgreSQL repository/migration and mobile SQLite queue. This pack builds on v1 and v1.1. It is not deployed to the live repository.

## 1. PostgreSQL backend
Use your existing pool/session/device policies; do not create another messaging database. Apply server/postgres.sql as the next actual migration. Upload ID is UUID; canonical string owner/chat identifiers in this new metadata table are mapped by policy queries to the existing schema. No assumed conversation_members join is supplied.

```js
import {connectPhotoVideoBackend} from './media/connect-backend.mjs';
connectPhotoVideoBackend({
 app,express,pool,
 privateBlobDirectory:serverConfig.privateMediaDirectory,
 authenticate:existingSessionMiddleware,
 requireBoundDevice:existingDeviceSessionBinding,
 uploadRateLimit:existingUploadRateLimit,
 authorizeChatMedia:existingChatMediaPolicy.authorize,
 reserveQuotaAndVerifyMembership:existingChatMediaPolicy.reserveInTransaction
});
```

Names beginning existing* represent YOUR repository implementations, not provided exports. authorize checks current membership/block/account/device for both send/read. reserveInTransaction repeats checks in the supplied Postgres transaction and reserves upload bytes under quota lock. Mount before broad body parsers. Bind methods to their owning service if they use `this`. Missing connections cause startup errors rather than permission bypass.

Routes:
PUT /v1/chats/:id/media/:uploadId — encrypted bytes, digest header.
GET /v1/chats/:id/media/:uploadId — authorized encrypted download.

Rate limit and concurrency limit BEFORE raw body parser. Supply actual private persistent storage and orphan reconciliation. See APPLY.md for quota/retention/storage limitations; no production workers are claimed. Calls and read receipts are unaffected.

## 2. SQLite/mobile wiring
Use existing Expo SQLite handle and versioned migrations, not a new plaintext key store. connectChatMedia includes schema initialization for review but should be moved into the repo migration manager. Require real account/device/chat scope.

```ts
const media = await connectChatMedia({
 db: existingMessagingDb,
 scope: {accountId:selfId,deviceId,chatId:conversationId},
 apiBase: API,
 boundDeviceId: accountId => existingDevice.bindingId(accountId),
 crypto: existingAttachmentCryptoAdapter,
 files: existingPrivateEncryptedFiles,
 authHeaders: scope => existingSession.headersFor(scope.accountId,scope.deviceId),
 ensureMessageQueued: (scope,payload,id) => existingMessaging.ensureQueued(scope.chatId,payload,id),
 newId: () => Crypto.randomUUID(),
 assertLive: scope => existingGate.assertCurrentScope(scope)
});
```

These existing* placeholders must map actual source. AttachmentCrypto interface in connect-media.ts defines the mapping. Encryption is mandatory: server never receives raw gallery/photo/video bytes. Caption/keys are encrypted in the message and locally encrypted descriptor. ensureQueued must atomically return existing sealed envelope for stable message ID; calling seal again on retry is forbidden.

Build connection only for current scope, discard late async setup if account/device/thread/gate generation changed. Use the real bound installation ID; no empty string. Existing gate assertion must cover focus/lock/block/account/device/chat changes. on background invalidate active scope immediately. Camera picker return may require foreground gate re-check; never reuse draft across account switch.

## 3. Composer
Use the included updated ChatComposer.tsx and PhotoVideoToggle.tsx:

```tsx
<ChatComposer
 scopeKey={JSON.stringify([selfId,deviceId,conversationId])}
 enabled={gateState.mode==='LIVE' && !blocked && Boolean(media)}
 onText={sendText}
 onMedia={(draft,caption) => media ? media.send(draft,caption) : Promise.resolve(false)}
 onAdd={openExistingAddSheet}
 onVoice={openExistingVoiceCapture}
/>
```

Photo or Video selection persists as the single visible icon while the popup closes. Selection opens the system capture flow. Preview appears before Send. Plus opens gallery/more attachments. Use theme mapping from SELECTOR.md for your screenshot's light composer if retaining ComposerArea. This bundled ChatComposer keeps the previous pack's indigo colors; the selector itself accepts existing theme props.

## 4. Resume/receive
Call media.flush() on foreground/connectivity while verified LIVE, catching errors and showing a waiting state. FAILED rows are returned by media.failed(); media.discard() allows only failed, non-flight jobs. Normal queued-message discard stays in the existing outbox.

Use media.pipeline.receive(scope, typedMappedPayload) from existing MessageBubble open handler. Existing crypto decryptFile must verify digest + AEAD and scope BEFORE returning private playable URI. Map reference MediaPayload to existing conversation-engine Payload, update parse/render logic where required. Cleanup private decrypted previews on lock/account switch and prepared ciphertext through existing outbox ACK/retention. See APPLY.md for early-preparation cleanup and lifecycle obligations.

## Checks / activation
`npm test` executes existing 15 tests plus backend startup-connection tests. Tests use actual SQLite/private disk; fake client crypto tests verify contract flow only. PostgreSQL integration, Expo typecheck, native build and Samsung tests require the live repo and have not been run. No repository URL/source or phone connection is present here. Do not advertise feature activated until actual crypto/auth/payload connections, Postgres tests and recipient-device media opening pass.
