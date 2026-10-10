# Linqa Durable Receive Closure v3

Status: reference implementation and integration pack, NOT installed or production-certified. Node reference tests execute real SQLite + AES-GCM, with a deliberately fake message crypto core. Kotlin, React and server integrations have not been compiled against your current repo. Your reported 103 tests are separate from this pack's tests.

## Files and implementation order
1. android/DurableInbox.kt: Android Keystore local AEAD, atomic SQLite inbox + replay/ratchet state, receipt queue. Implement StagedCore using existing Rust core and SessionAuthority using authenticated session/device/lock authority. Run on a worker executor, not UI thread. Bridge methods in shared/native-adapter.ts are the binding contract; register them in your existing Expo native module.
2. shared/durable-store.mjs: runnable transaction reference for desktop/native-core test harness, not a mobile polyfill. Node >=24 required. Never ship the test key or fake core.
3. shared/native-adapter.ts: capability and bound device checks; refuses missing native storage. Wire server receipt transport.
4. shared/receive.mjs + react/useDurableReceive.jsx: retry classification, epochs, verified-key revisions and viewability-triggered receipt queue.
5. server/per-message-receipts.sql + read-handler.mjs: authorization-first idempotent receipt writes beside existing chat_messages. Map existing DB/membership schema. No second messaging history.
6. react/UnavailableMessage.tsx: honest consumed-history and verification failure UI.

## Why an existing open() wrapper cannot finish this
StagedCore.prepareOpen must deserialize supplied account/device state, verify authenticated envelope membership/context, clone ratchet/session state, decrypt, apply replay checks to the clone, and RETURN the new state without mutating persistent/global core state. Native transaction encrypts the returned payload and new state in the same SQLite commit. The next call reloads committed state. For failure, neither change survives. All send, key-update and receive mutations for those sessions MUST share this authoritative transaction store; leaving send on an independent state store can invalidate ratchets. Serialize account/device state, including multiple conversations, not just individual threads.

The native core source and FFI signatures were not supplied. StagedCore and SessionAuthority implementations cannot be accurately invented here. They are mandatory connections, not safe defaults. Do not advertise durableReceiveVersion=1 until they are implemented and native fault tests pass. iOS/web also need platform transaction and protected-key bindings; Android Kotlin is not a cross-platform storage implementation.

## Existing state migration
- Do not clear existing replay state. Import its complete versioned serialized state into encrypted receive_state for account/device before enabling the new bridge, using a migration transaction and validated ownership. Freeze old mutations throughout migration.
- If export/import is unavailable, keep capability disabled. A new empty state beside the old replay store is unsafe.
- Older already-consumed envelopes without a cache return REPLAY_WITHOUT_CACHE, rendered unavailable with no retry. New sessions/devices may receive independent copies through existing device fanout; don't reset replay to recover old messages.
- Core state may include several sessions and ratchets; ciphertext scope checks and conversation binding belong in native core verification.

## Route/device connection
Resolve identity from the current native device binding, not route params or an arbitrary persistent UUID:

```ts
const adapter = await createDurableAdapter(nativeCore, selfId, {
 postRead: async(scope, messageIds) => {
   await authenticatedClient.post(`/v1/conversations/${encodeURIComponent(scope.conversationId)}/read-messages`, {messageIds});
 }
});
// Render only after successful initialization; use a loading/locked state on failure.
// In conversation.tsx pass deviceId={adapter.deviceId} and receiveAdapter={adapter}.
// Screen/hook Options must require deviceId: string (no default).
// key={`${selfId}:${adapter.deviceId}:${conversationId}`} on ConversationScreen.
```

Endpoint path is new and must be mounted in existing router; do not call it before server deployment. readHandler receives session and bound device from server auth. The visibility query must validate all IDs inside its transaction and hold a membership lock consistent with revocation writes. Receipt UI must read chat_message_reads_v3 by individual ID; never convert these rows into a cumulative last-read marker.

## Hook/screen integration
- Keep existing send/outbox/rejection panel. Replace only receive decrypt and mark-read paths with useDurableReceive; remove duplicate effects.
- Convert receiver entries into existing MessageBody: state=open passes payload; all other states render UnavailableMessage. Do not rely on display-text matching.
- FlatList onViewableItemsChanged should call displayed(openedIncomingIds) only when app active, navigation focused and security gate LIVE. Catch queue/network errors, retaining durable pending receipts; flush on foreground/connectivity restoration. Avoid logging plaintext. For already-open messages seen again, duplicate receipt writes are idempotent.
- Require parseBody identity stable (imported function); adapter and keyEvents identity stable. Bridge verified-key events through verifyKeyRevision, which checks signed key material/account/device binding before returning the revision. No boolean trust shortcut. If no verified event source exists, manual retry still works; leave automatic path disconnected honestly.
- On gate evaluation, invalidate receive synchronously BEFORE awaiting probes. A transition LIVE -> CHECKING -> LIVE cannot accept old operations. Every gate result must compare its own monotonic probe ID and current scope.
- History loads/subscriptions/send callbacks must likewise use account/device/conversation + generation checks before success, catch and finally state writes. Screen key unmounts old state; cleanup invalidates outstanding callbacks and unsubscribes. Do not show old rows for one render during account changes.
- Cache plaintext is only in JS memory while LIVE; native access guard also enforces lock/revoke. Background immediately invalidates plaintext; foreground re-evaluates security before cache decryption.

## Lane fix
Keep your successful `const [lane] = useState<Lane>('All')`. No setter is required until picker exists. Remove dead lane UI only if product decision requires it. This pack does not override your clean typecheck.

## Storage lifecycle
Use a database and key alias per bound account/device or equivalent strict separation. Generate the alias from a canonical account/device digest. AndroidAead uses Keystore generated AES-GCM IVs. SessionAuthority must protect every method against lock and device revocation. Configure SQLite WAL and synchronous FULL once at database open. Exclude database/WAL/SHM from Android and cloud backup. No plaintext logging, analytics or backups. Purge account by closing its database, deleting database/WAL/SHM and destroying its dedicated key on explicit account removal/revocation. Apply expiration/deletion to inbox and receipts together; do not delete replay state for expired messages. Normal logout policy must be explicit; if preserving history, retain encrypted files and deny access until re-authenticated.

## Platform limits and verification
Node tests: `node --test tests/closure.test.mjs`. Kotlin requires Android SDK and your native core. React requires your project's types and build. No SDK or full repo exists in this workspace; those checks were not run.

Before capability enablement: actual-process crash at each commit boundary; reopen old/new inbox; corrupt ciphertext; replay another ID; substitute envelope; concurrent threads sharing ratchet state; device/account switch mid-open; revoke/lock mid-open; transient key recovery; verified key event rejection; two phones and linked desktop/web; restart offline; receipts for displayed messages with unreadable gaps; receipt resend after server acceptance/local ack failure. Preserve the installed app's signing identity; do not uninstall to bypass keystore mismatch.

Completing these repository-specific bindings and native/device checks is necessary to close the situation completely. Delivering a reference pack alone does not activate it.

Primary Android API reference: https://developer.android.com/reference/kotlin/android/security/keystore/KeyGenParameterSpec
