# Item 1: persist and display permanently rejected outgoing messages

This is a focused integration patch, not a replacement messaging stack. The supplied route/screen snippets are enough to locate the UI edits; sealed-text-outbox.ts, outbox.ts, sqlite-outbox.ts and conversation.service.ts were not supplied. Their exact row shapes and database methods therefore need the adapter mapping below. No lc2 tables, key changes, plaintext drafts or receive/cursor changes are introduced.

## 1. Extend the existing outbox persistence

Keep each existing sealed bundle unchanged. A rejection updates its state and reason in one durable transaction. FAILED_PERMANENT is already supported according to the supplied notes. Add a nullable errorCode field to the existing row model and its SQLite storage/migration if no equivalent field exists; map the equivalent field if it already exists. Do not invent a second outbox table or use React state as the authoritative record.

Implement RejectedOutboxPersistence from services/rejected-outbox.ts against MobileOutboxDb:

```ts
const failurePersistence: RejectedOutboxPersistence = {
 async markPermanent(scope, messageId, code) {
  // In ONE existing DB transaction:
  // locate by accountId + conversationId + stable messageId;
  // verify it is this sender's queued/retry row, never an accepted row;
  // update state=FAILED_PERMANENT and errorCode=code;
  // do not alter sealed bundle bytes, message ID, or original timestamp.
  // Repeating the same terminal update must be idempotent.
  await existingOutboxRepository.markPermanent(scope, messageId, code);
 },
 async listPermanent(scope) {
  // SELECT existing rows scoped to account/conversation, state FAILED_PERMANENT.
  // Map to {accountId,conversationId,messageId,createdAt,errorCode}; no bytes.
  return existingOutboxRepository.listPermanent(scope);
 },
 async deletePermanent(scope, messageId) {
  // Conditional atomic delete by account/conversation/message/state.
  // Missing/already discarded row is a successful no-op.
  await existingOutboxRepository.deletePermanent(scope, messageId);
 }
};
```

existingOutboxRepository above describes required methods to implement; it is NOT an imported object included in this patch. Do not paste it as an existing API. Map these operations to the actual db.update/query/delete methods only after reading the missing files. Their field names were not provided. Existing pending() must continue excluding FAILED_PERMANENT; add a regression test against the real DB adapter.

At the end of sealedTextOutbox(db,selfId), construct one notifier for the account and attach it to that same outbox instance:

```ts
import {createRejectedOutbox,type RejectedOutbox,
 type RejectedOutboxPersistence} from './rejected-outbox';

// Add to the existing SealedTextOutbox type:
// failures: RejectedOutbox;

const failures = createRejectedOutbox(failurePersistence,selfId);
return { /* existing enqueue/pending/accepted methods */, failures };
```

The comment in that return represents existing methods, not a replacement return to paste. Retain all existing members and add only failures. Call failures.reject for both direct-send and flush rejection paths so its subscriber sees each committed change.

## 2. Change conversation.service.ts post()

Remove the existing deletion in the rejection branch at the reported line 169. Keep deletion/acknowledgment on successful relay acceptance exactly as it works today.

Use postWithRetention around the existing post operation, or place its catch logic directly into post(). That operation must throw a structured relay error with status and a documented server code. Do not classify by error-message text.

```ts
import {postWithRetention,isDefiniteRejection,safeCode,
 type RejectedOutbox} from './rejected-outbox';

function classifyRelayError(error: unknown) {
 const e = error as {status?:unknown;code?:unknown} | null;
 const status = e && typeof e.status==='number' ? e.status : 0;
 const code = safeCode(e?.code);
 return {permanent:isDefiniteRejection(status,code),code};
}

// Inside the existing post method, AFTER selecting the queued sealed row:
if (!this.outbox) throw new Error('DURABLE_OUTBOX_REQUIRED');
await postWithRetention({
 row: {conversationId, messageId: clientMessageId},
 failures: this.outbox.failures,
 classify: classifyRelayError,
 post: async () => {
  // Existing HTTP post of EXACT queued sealed bytes, unchanged.
  // Throw structured failure on non-acceptance. On success, run the existing
  // durable relay-accepted handling/removal, then resolve.
 }
});
```

The post callback is a placement template: move the existing networking and successful-ack handling into it. Do not leave an empty callback, which would report success without sending. Your real queued row may call its stable ID clientMessageId rather than messageId; map that once. Keep a rejected ciphertext row until a successful explicit Discard.

The included classification list is conservative and must match actual relay codes. Unknown 4xx, 401, 409, 429, 5xx and network errors are retained as unresolved; they stop the flush pass. Map documented equivalent codes from your server. A blanket "all 4xx are permanent" rule is unsuitable.

## 3. Connect flushOutbox

Use flushRetained for the pass over the existing pending rows:

```ts
import {flushRetained} from './rejected-outbox';

async flushOutbox(onRejected?: (messageId:string,code:string)=>void) {
 if (!this.outbox) return;
 const rows = await this.outbox.pending();
 await flushRetained({
  rows: rows.map(row=>({
   row,
   conversationId: row.conversationId,
   messageId: row.clientMessageId // map actual field name
  })),
  post: async ({row}) => {
   // Invoke the EXISTING post method with its existing argument signature.
   // post now uses postWithRetention and keeps successful ack behavior.
  },
  failures: this.outbox.failures,
  classify: classifyRelayError,
  onRejected
 });
}
```

Again, populate the post callback with the actual invocation; its signature was not provided. PersistedRejection marks a rejection already committed by postWithRetention; flushRetained then notifies without writing twice and continues. A DB failure propagates and stops the pass. Keep your existing flush single-flight/lease protection; startup and foreground flushes must not concurrently claim the same row. Listener/callback failure does not affect committed state.

## 4. Wire conversation.tsx

Add near its other state declarations, BEFORE the startup flush effect:

```ts
const [rejectionNotice,setRejectionNotice] = useState<string|null>(null);
```

Replace the current startup/foreground flush effect with:

```ts
useEffect(()=>{
 if(!outbox)return;
 let active=true;
 const flush=()=>{
  void service.flushOutbox((_messageId,_code)=>{
   if(active)setRejectionNotice('An outgoing message was not sent. Review your chats.');
  }).catch(()=>{
   // Keep queued bytes. A network/auth/persistence failure is not acceptance.
   // Existing connectivity status may be updated here; do not delete rows.
  });
 };
 flush();
 const sub=AppState.addEventListener('change',s=>{if(s==='active')flush();});
 return()=>{active=false;sub.remove();};
},[outbox,service]);
```

Because the flush covers all account conversations, this notice is generic. The panel below independently queries only the current conversation; avoid suggesting that a refusal in another conversation belongs to this thread. Prefer changing the notice to "An outgoing message was not sent. Review your chats." if cross-thread flushes are common.

Add these props to the existing ConversationScreen call:

```tsx
rejectedOutbox={outbox?.failures}
notice={notice ?? rejectionNotice}
```

Replace its existing notice prop, rather than adding a second notice prop. The existing route already keys RealConversation by account+conversation, which helps isolate remounts. The panel also rejects stale asynchronous updates after its scope changes.

## 5. Wire ConversationScreen.tsx

Add imports:

```ts
import type {RejectedOutbox} from '../../services/rejected-outbox';
import {RejectedMessagesPanel} from './RejectedMessagesPanel';
```

Copy components/RejectedMessagesPanel.tsx into components/conversation/ and change its relative import to '../../services/rejected-outbox'. Add to ConversationScreenProps:

```ts
rejectedOutbox?: RejectedOutbox;
```

Create the panel after live is defined:

```tsx
const rejectedPanel = props.rejectedOutbox ? (
 <RejectedMessagesPanel
  outbox={props.rejectedOutbox}
  conversationId={conversationId}
  enabled={live}
 />
) : null;
```

To show it for both an empty thread and a nonempty inverted list without hiding it, insert `{rejectedPanel}` inside KeyboardAvoidingView immediately after the load-error notice and before the existing empty/FlatList conditional. This renders a separate Not sent panel above the history. It does not invent a plaintext MessageBody or make the sealed bundle pass through buildTimeline. For many failures, replace the panel's map with a bounded scroll/modal so it cannot occupy the whole phone screen.

It reloads from durable DB at mount, subscribes after live sends/flush/discard, hides while the messaging gate is locked, and requires confirmation before discard. No Retry button appears on permanent rejections. Existing pending-memory failed bubbles may duplicate the durable panel after a live rejection: when catching PersistedRejection in useConversation.send, remove that temporary pending bubble instead of retaining it. Only do this after the typed exception confirms the failed row was durably committed:

```ts
import {PersistedRejection} from '../../services/rejected-outbox';
// In send catch, within your current scope/mounted guard:
if (e instanceof PersistedRejection) {
 setPending(p=>p.filter(m=>m.id!==tempId));
} else {
 setPending(p=>p.map(m=>m.id===tempId?{...m,delivery:'failed'}:m));
}
```

Keep existing secure-core error handling. This item does not repair every async/gate race in useConversation; do not claim that broader fix is included.

## 6. Tests and integration boundary

Run `node --test tests/rejections.test.mjs` with Node 24+. The included tests use a fake DB to check state retention, scoped listing, restart reconstruction, conditional discard, continued flush, uncertain-outcome preservation, persistence failures and notification exceptions. They do not execute the missing SQLite adapter or render React Native.

After mapping the adapter, run your existing tsx-driven test suite, host typecheck, and real SQLite restart tests. Confirm a permanent failure remains visible after restart and a transient/uncertain message remains queued with identical bytes and ID. A successful resend must never be inferred from a UI callback. APK/device verification remains separate.

Original pasted files were not modified. Item 1 code is supplied for integration; the live repository has not been patched.
