# Linqa Secure Send v2 — activation integration

Status: tested source pack; not deployed or activated in your live application.
This package replaces the supplied three-file pack. It supports the same shared
send interface on Android/iOS, browser and desktop once platform adapters are
connected. Compatibility is an architecture target, not a device certification.

## Findings in the supplied attachment

1. Files in clients/shared import ../../shared/secure-send even though the ZIP
   contains only clients/shared/secure-send.ts. Imports therefore target a file
   absent from the archive. v2 uses colocated imports.
2. Each device independently creates a random conversation AES key on first
   send. No authenticated agreement/provisioning mechanism is included; another
   device cannot decrypt that message just because it is registered.
3. AES-GCM does not bind conversation/message IDs as AAD; no sender device
   signature, native ratchet protocol or revocation mechanism is supplied.
4. btoa(plaintext) is not an encryption test and fails for many Unicode strings.
5. The transport captures one token forever and assumes a /v2/chats contract.
6. There is no backend, durable encrypted outbox, key bootstrap or device tests.

Do not roll out the attached AES key-generation path as all-device messaging.
v2 removes that crypto implementation and delegates encryption/decryption to
your existing verified Linqa protocol, including DeviceIdentity, NativeCore,
KeyPackageApi and trusted device-link bootstrap. Their actual interfaces were
not supplied, so this pack specifies a strict bridge rather than inventing APIs.

## Included implementation

- Shared TypeScript send/read activation factory, correctly resolved imports.
- Verified device fan-out including sender's linked devices and recipient's
  devices; refuses missing keys or inactive sender devices.
- Durable encrypted outbox abstraction and actual browser IndexedDB adapter.
  A SQLite schema and parameterized native storage mappings are included.
- Exact-byte retries with stable client IDs and relay-acceptance semantics.
- HTTPS transport, fresh session token per request, timeouts and encoded IDs.
- Authenticated Express relay, parameterized PostgreSQL schema/repository,
  membership/policy checks, active device checks and idempotent transactions.
- Required transactional append authorization hook for live block/device checks.
- Unit tests. No test-only crypto or memory storage is imported by production code.

## Connect the backend

Use the host's existing Express and pg versions. Apply server/schema.sql through
your migration runner in staging. The lc2 prefix avoids overwriting existing
chat tables; add user FKs against the actual canonical accounts table after
schema review. For existing history prefer mapping the repository to the
canonical relay tables rather than starting a second history store.

```js
import {createConversationRouter} from './server/router.mjs';
app.use('/v2/conversations',createConversationRouter({
 express,pool,
 authenticate: existingDeviceBoundSessionMiddleware,
 authorizeMutation: existingCsrfOrBearerMutationGuard,
 rateLimit: existingAccountDeviceRateLimiter,
 policy: {canChat: canonicalChatPolicy},
 devices: {isActive: canonicalDeviceActive,listForUsers: canonicalDeviceList},
 authorizeAppend: transactionalChatAuthorization
}));
```

authenticate must validate the account session AND its bound device and set
req.actor={userId,deviceId}. Never trust a body/header user ID. canChat must
enforce active registered accounts, chat-request/discovery rules and blocks in
both directions. Device lists must exclude pending/revoked devices.

The mandatory authorizeAppend(pgTransaction,{conversationId,actor,envelopes})
must revalidate membership, block policy and exact active target devices inside
the SAME transaction, using locks/version checks coordinated with revocation
and block writes. Throw on denial. The source cannot implement canonical-table
locking without your real schema. This hook is not optional or an allow-all
placeholder; the repository refuses construction without it.

Endpoints match deviceTransport:
GET /v2/conversations; POST /v2/conversations/direct {peerId};
GET /v2/conversations/:id/events?after=cursor;
POST /v2/conversations/:id/events {clientId,envelopes}.

## Connect each client

```ts
import {activateSecureSend} from './clients/shared/activateSecureSend.ts';
import {deviceTransport} from './clients/shared/deviceTransport.ts';
import {durableOutbox} from './clients/shared/durableOutbox.ts';
const secureSend=activateSecureSend({
 actor:{userId:session.userId,deviceId:session.boundDeviceId},
 protocol: verifiedLinqaProtocolBridge,
 outbox:durableOutbox(existingTransactionalSqliteStore),
 transport:deviceTransport({baseUrl:configuredHttpsApi,
   getToken:getCurrentSessionToken,fetchImpl:fetch}),
 uuid:cryptographicallySecureUuid
});
// Browser: use (await browserOutbox(indexedDB)).outbox instead of SQLite.
// Build a fresh instance on account/device changes, close the previous instance.
```

The protocol bridge implements assertReady, verifiedSnapshot, seal and open
from clients/shared/secure-send.ts. No automatic conversation-key creation is
performed. assertReady must check actual native/browser protocol availability,
production key-store readiness and a valid registered device. verifiedSnapshot
must authenticate key package signatures and account/device bindings, not just
trust an API response. seal must bind the conversation, sender account/device,
message ID and target device within the signed native protocol. open must verify
that context and sender key binding before returning plaintext. Ratchet state,
replay counters and send-state crash consistency belong in the native adapter.

Use OS-protected key storage on native platforms and the existing approved
browser key-storage implementation. This pack stores no raw conversation keys.
Do not copy Android app-signing keys into the messaging store: APK signing and
message encryption use different keys for different purposes.

## Connect the conversation screen

```ts
async function onSend(text:string){
 const queued=await secureSend.send(conversationId,text);
 // Clear composer only after durable queue commit; show queued, not delivered.
 updateMessageState(queued.clientId,'queued');
 try{
  for(const result of await secureSend.flush())
   updateMessageState(result.clientId,result.state);
 }catch(error){showRetryForQueuedMessage(error);}
}
```

Run flush at authenticated app startup, foreground and network recovery using
the host's lifecycle hooks. Serialize polling too: await read(id,cursor), store
decrypted records in the approved encrypted local inbox, THEN commit cursor.
Do not advance the cursor on authenticated-decryption failures. Persist the
inbox/cursor consistently with native replay counters. Never log plaintext,
session tokens, key packages or encryption secrets.

The relay acknowledges storage, not recipient delivery/read status. Add those
statuses only through the existing authenticated receipt mechanism. Queued
messages are already encrypted; exact retry bytes are preserved after restart.
The client has no background execution guarantee when the OS/browser suspends it.

If server returns 409 because device eligibility changed, retain the batch and
stop automatic retries until a host rekey/revocation flow resolves it. Do not
silently drop devices. Check canonical relay acceptance by client ID before
replacing a pending encryption batch; automatic rekeying after an uncertain
network outcome is not implemented here. This avoids duplicate sends and
unintended key downgrade.

## Linked devices and history

Future messages target every authorized device. Old messages do not magically
become available on newly linked devices. Connect your authenticated device-link
bootstrap for consented encrypted history transfer, key rotation and recipient
identity verification. Existing /v1/relay/envelopes history needs an explicit
repository mapping or migration. This pack does not silently migrate old AES
messages or invent a shared key for them.

## Verification and activation boundary

All 24 delivered unit tests passed. Run npm test with Node 24+; Node strips the TypeScript syntax for these tests.
Use your host TypeScript/bundler config for actual clients (.ts extension imports
may require allowImportingTsExtensions or rewriting import suffixes during build).
The tests use fake protocol/network/store adapters to verify orchestration.
They do NOT certify the native crypto, IndexedDB browser behavior, SQLite,
PostgreSQL, physical Android/iOS devices, browser or desktop runtime.

Before setting the real app's send feature active: connect all mandatory
adapters; run app/server typechecks and actual DB tests; verify A→B and B→A on
two physical devices plus sender/recipient desktop/web; test restart retries,
revocation, block changes, account switch, offline recovery and secure history
bootstrap. Use the original matching Android APK signing key to update the
Samsung installation without uninstalling; that key is not supplied in this pack.

To activate rather than just deliver code, the current Linqa repository and
deployment/device build access are required. They were not included with these
attachments. No live configuration, app installation or server deployment was
changed by producing this pack.
