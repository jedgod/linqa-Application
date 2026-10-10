# Linqa Conversation v2 — Indigo + Apricot

An additive conversation module for the existing Linqa application. Includes React web, React Native mobile, a shared encrypted-event client, Express routes, PostgreSQL tables, and unit tests. It is source code for integration, not a modification of your live repository. Existing authentication, device directory, cryptography, block/discovery policy, calling, notifications and attachment modules must be connected using the contracts below. No plaintext fallback is provided.

## Design and implemented features

- Violet, midnight and apricot themes. No green, doodle wallpaper or WhatsApp branding.
- Individual conversation screen, message history, text composer, clear relay acceptance and retry states.
- Encrypted topic lanes: All, Plans and Ideas. Messages retain their lane inside their encrypted payload.
- Encrypted decision boards: share 2–5 choices (mobile/web creation UI currently offers two), one vote per participant, latest vote wins, counts computed on clients.
- Local appearance and mute preferences, persisted through a device-storage adapter.
- Backend membership checks, canonical chat-policy checks, active-device checks, device-target validation, bounded ciphertext batches, pagination and transactionally persisted idempotency.
- Opening a registered person creates or reuses one direct conversation via a unique pair key.

These are distinctive combinations for Linqa; no claim is made that they are globally unprecedented.

The image is a design concept. The code does not implement timed quiet hours, a calendar-linked Plans card, photo attachments, vote-avatar displays, delivery/read checkmarks or custom icon artwork. Calls, voice, attachments, safety numbers and blocking invoke the supplied host handlers. The UI shows an integration notice when they are missing. The code labels relay acceptance accurately; it does not claim recipient delivery. Quiet is a per-conversation mute flag, not the image's timed schedule.

## File map

| File | Responsibility |
| --- | --- |
| server/schema.sql | Additive relational schema |
| server/postgres.mjs | Parameterized SQL, transactions, direct-pair deduplication |
| server/service.mjs | Membership, policy, device-set and payload validation |
| server/router.mjs | Authenticated Express route factory |
| shared/engine.mjs | Encrypted events, lanes, decisions, vote projection |
| shared/useConversation.jsx | Sequential polling, pending sends, stable retries |
| shared/connection.mjs | HTTPS client, navigation and preferences helpers |
| web/Conversation.jsx + conversation.css | Responsive web/desktop UI |
| mobile/ConversationScreen.jsx | React Native conversation UI |
| tests/conversation.test.mjs | Security and event-behavior unit tests |

## Backend connection

1. Back up and inspect the actual live schema. Apply schema.sql in staging using your migration runner. Bind lc2_members.user_id to your actual canonical user UUID table with an FK after confirming its name. These lc2 tables deliberately do not overwrite existing tables. Do not blindly assign a migration number.
2. Import createConversationRouter into the existing authenticated Express server (the earlier Linqa setup used port 8088; use your current configured port).
3. Mount it after your host security middleware:

```js
import {createConversationRouter} from './conversation/server/router.mjs';
app.use('/v2/conversations', createConversationRouter({
 express, pool,
 authenticate: existingSessionMiddleware,
 authorizeMutation: existingCsrfOrBearerMutationGuard,
 rateLimit: existingAccountAndDeviceRateLimiter,
 policy: chatPolicyAdapter,
 devices: deviceDirectoryAdapter
}));
```

Required adapter contracts:

```js
// authenticate(req,res,next) validates the session AND binds the device to it.
// Set req.actor = {userId: canonicalUuid, deviceId: trustedBoundDeviceId}.
// Never trust request-body sender IDs, X-User-Id or an unvalidated device header.
// authorizeMutation(req,res,next) enforces host CSRF/origin checks for cookie
// sessions or validates the already authenticated bearer-only mutation policy.
const chatPolicyAdapter = {
 async canChat(senderId,peerId) {
   // Return true only for existing active accounts, allowed discovery/request
// state and no block in either direction. Use your canonical repository.
   throw new Error('Connect canonical account + block + discovery repositories');
 }
};
const deviceDirectoryAdapter = {
 async isActive(userId,deviceId) {
   throw new Error('Connect canonical active/revoked device repository');
 },
 async listForUsers(memberIds) {
   // Return all eligible trusted devices including sender devices:
   // [{userId,deviceId}, ...]. No expired, revoked or pending devices.
   throw new Error('Connect canonical trusted device repository');
 }
};
```

The throws above are intentional contract examples, not working production adapters. The router refuses to mount without required functions and rejects inactive devices. Session failures should be terminated by host middleware. Host middleware must enforce CORS, HTTPS, token validation, request rate limits, privacy-safe logging and notification settings. Never install an allow-all policy.

## Client and registered-person navigation

```jsx
import {connectConversation,openPersonConversation} from './conversation/shared/connection.mjs';
// Inside your authenticated account scope, memoize this object.
const client = connectConversation({
 apiOrigin: configuredLinqaApiHttpsOrigin,
 getAccessToken: getCurrentSessionToken,
 crypto: existingE2eeConversationAdapter,
 actor: {userId: signedInUserId,deviceId: trustedDeviceId},
 uuid: secureRandomUuid // Expo Crypto UUID on mobile; crypto.randomUUID on web
});
await openPersonConversation({client,peer:registeredPerson,navigate:({conversationId,peer})=>{
 // Existing Expo/React router: open the route containing ConversationScreen
 // or Conversation, using this conversationId and canonical peer record.
}});
```

Attach openPersonConversation to each existing registered-user search result and Chats row. Use the existing discovery-aware directory; this pack does not create a parallel global account search. Resolve peer records from trusted session/API data, not an arbitrary route-supplied name. The backend performs its own policy checks. Preserve existing chat history through the mapping plan below.

Render ConversationScreen on mobile under SafeAreaProvider; it requires your installed react-native-safe-area-context. Render Conversation for web/desktop. Supply a memoized client and the conversationId. Use the host React, React Native, Express and pg versions and lockfile rather than installing wildcard peer dependencies as a new standalone app. No new crypto dependency is introduced.

Supply onBack, onCall(kind,peerId), onSafety(peerId), onBlock(peerId), onAttach(), and mobile onVoice(). Blocking must write the canonical block repository used by canChat; clear decrypted state and exit the screen after confirmation. Do not show success from a no-op. The settingsStore uses load(id) and save(id,{theme,quiet}); localPreferences provides an account-scoped implementation using host read/write storage functions. Notifications must consult quiet before displaying alerts.

## Cryptographic bridge — mandatory

Use the existing Linqa NativeCore / DeviceIdentity / KeyPackageApi / E2eeMessageRepository implementation after reviewing its actual current interfaces. This pack does not implement a second cipher, ratchet or native key store.

```js
const existingE2eeConversationAdapter = {
 async encryptForDevices(payload,{conversationId,senderId,clientId}) {
   // 1. Resolve both users' active verified device key packages.
   // 2. Verify signatures and perform the existing authenticated protocol.
   // 3. Encrypt JSON payload separately for every eligible trusted device.
   // 4. Authenticate conversationId, senderId, clientId and device context as AAD.
   // 5. Return [{userId,deviceId,ciphertext:base64}, ...].
   throw new Error('Connect verified native E2EE send implementation');
 },
 async decryptAuthenticated(ciphertext,{conversationId,senderId,clientId}) {
   // Verify sender key/account binding, signatures, AAD and replay protections
   // using existing native crypto. Parse JSON only after verified decryption.
   throw new Error('Connect verified native E2EE receive implementation');
 }
};
```

Never base64-encode plaintext as a substitute for encryption. Schema/validation cannot prove ciphertext authenticity; the native adapter must. Encryption key lifecycle, forward secrecy, verified safety numbers, newly linked device history and key rotation remain responsibilities of the existing messaging protocol. Server can reject changed device sets with 409; refresh keys and retry using the same clientId. The UI retains stable IDs for retries but the in-memory pending queue is lost when the app restarts; wire the existing encrypted durable outbox before production.

## Existing relay/history mapping

This pack's lc2 transport is additive and does not migrate existing /v1/relay/envelopes or history automatically. Choose ONE authoritative storage path before deploying:

1. Prefer using existing relay infrastructure: implement the repo methods open, members, list, history and append against canonical conversation/relay tables, then inject that repository into createChatService in the router. Preserve transactionality and idempotency semantics.
2. Alternatively adopt lc2: write and test an explicit mapping of existing conversation IDs and ciphertext metadata. Never copy plaintext or silently split one conversation across two stores.

The HTTP client and server agree on /v2/conversations, /direct, /:id/events?after=cursor and /:id/events. Polling is sequential at 3 seconds; pagination drains 100-event pages. Switch to the existing authenticated WS wake-up flow later while keeping HTTP replay/cursor recovery. New linked devices do not receive historical envelopes unless the existing protocol supplies a secure history-transfer mechanism.

## Validation and release boundaries

Run `npm test` (or `node --test tests/*.test.mjs` without installing packages). Thirteen unit tests passed in the delivered version. They check nonmember denial, blocked initiation/send, self-chat rejection, duplicate/unauthorized/missing device targets, valid envelope batches, cursor validation, malformed ciphertext, vote replacement, invalid decision payloads, stable retry IDs, and authenticated-decryption failure. These are fake-repository unit tests; they do not certify PostgreSQL migrations, native encryption, physical devices, React rendering or production hosting.

Before live use, run your host typecheck/bundler, execute PostgreSQL migration/integration tests, verify concurrent direct opens and duplicate sends, and test sending/receiving between two physical devices. Also test revoked devices, block changes, offline restart recovery, stale key packages, notification mute, accessibility, keyboard/safe-area layout and the existing account-switch flow.

Authorization/device checks and the append transaction are separate calls here. To close revocation races in your live environment, make policy/device eligibility and append participate in your canonical transaction or versioned authorization mechanism; the current adapter contract alone does not guarantee atomic revocation. Do not call this pack production-ready until that integration and physical-device verification are complete.

The ZIP and Notepad text contain identical source content. This is an implementable integration module with explicit missing host adapters, not a claim that the current Linqa application has been changed or certified.
