# Linqa items 2 and 3

This is an integration patch, not an activated app. Supplied hook and screen text were reviewed; native crypto/storage implementation was not supplied. Existing chat_messages and relay remain authoritative. No second server history.

## Item 2: durable encrypted receive and safe retries

Use receive-controller.mjs beside the hook (add a TypeScript declaration or convert it to TS in your project). It owns opened message memory, retry status, and generation checks. The existing older-history pagination cursor remains unchanged.

Required adapter:

```ts
interface ReceiveAdapter {
  readOrOpenAndCommit(scope: {
    accountId: string; deviceId: string; conversationId: string;
  }, row: ServerRow): Promise<string>;
  classify(error: unknown): 'transient' | 'blocked';
  safeCode(error: unknown): string;
  markRead(scope: {accountId:string; deviceId:string; conversationId:string}, id:string): Promise<void>;
}
```

readOrOpenAndCommit must:
1. Look up an inbox record bound to account, device, conversation, server message ID AND envelope digest. Reject a different envelope under the same ID.
2. Decrypt a matching local record with an authenticated account/device storage key in the secure core. Respect current lock policy.
3. On cache miss, verify/decrypt the envelope, then commit the locally encrypted payload, replay update and any ratchet mutation atomically BEFORE returning text. Include scope, ID, digest and schema version as authenticated associated data. Serialize competing opens of the same envelope.
4. Roll back both replay/ratchet and inbox writes on failure. An ordinary open() followed by SQLite insert is NOT sufficient: a crash between them can permanently lose readable history. If native replay and SQLite cannot share a transaction, implement this inside the native core's durable store. Keep this path disabled until available.
5. Encrypt with an established audited AEAD primitive through the existing secure core; generate unique nonces. Store keys in platform secure storage, never AsyncStorage or source code. Enforce account/device isolation, expiration and user-deletion policy. A database row is ciphertext only.

No reset of replay protection. This cannot retroactively recover envelopes consumed before durable inbox support; show an unavailable-history state for those.

Only explicit verified key-unavailable and retry-safe network errors classify as transient. Authentication, signature, replay-without-cache, payload validation, storage corruption and unknown errors classify as blocked. Do not pass raw errors to the UI or log plaintext. Automatic retries are capped at three attempts per gate generation and happen only on a NEW VERIFIED key revision. Explicit retry is available only for transient errors; block duplicate taps while opening.

Hook integration outline (add accountId/deviceId/receiveAdapter to Options):

```tsx
const [, refreshReceive] = useState(0);
const receiver = useMemo(() => new ReceiveController(
  receiveAdapter, parseBody, () => refreshReceive(n => n + 1)
), [receiveAdapter]);

// useLayoutEffect invalidates work before paint on scope/gate changes.
useLayoutEffect(() => {
  receiver.enter({accountId, deviceId, conversationId}, gateState.mode === 'LIVE');
  return () => receiver.enter({accountId, deviceId, conversationId}, false);
}, [receiver, accountId, deviceId, conversationId, gateState]);

useEffect(() => {
  if (gateState.mode !== 'LIVE') return;
  for (const row of rows) void receiver.open(row);
}, [receiver, rows, gateState]);

const retryUnreadable = (id: string) => {
  const row = rows.find(r => r.id === id);
  if (row && receiver.retryable(id)) void receiver.open(row, {explicit: true});
};
// Subscribe to verified core key changes, not UI settings or untrusted server hints:
const onVerifiedKeyRevision = (revision: string) => {
  for (const row of rows) void receiver.open(row, {keyRevision: revision});
};
const openedForRender = Object.fromEntries(receiver.bodies);
// Feed openedForRender into existing buildMessages. Remove old decrypt effect,
// old opened setter and decrypting set. Wire retryUnreadable to unreadable bubbles.
```

Use a stable adapter identity. Render rows and bodies only when their account/device/conversation scope matches the active screen. Key the whole screen by accountId/deviceId/conversationId so React state cannot carry history or drafts into another scope. Cleanup must invalidate receiver and dispose its verified-key subscription.

Replace existing mark-read effect: order rows oldest to newest using authoritative server sequence, call receiver.markOpenedRead(rows,selfId) only while LIVE. This stops cumulative receipts before an unreadable message. Add receipt dedupe and retry tracking in the adapter. Do not acknowledge encrypted rows merely because the gate is LIVE.

The old mounted flag also affects loadPage, subscribe, gate.evaluate and send. Give each operation an account/device/conversation token and monotonic generation; validate BEFORE every state write, including catch/finally. Increment gate generation synchronously when evaluating/locking, so a lock/unlock cycle cannot accept an old result. Clear rows, pending, cursor, hasMore, errors and receipt tracking on scope changes. An operation cancelled in UI may still commit encrypted data in its original scope; it must never paint in the new scope. Keep item 1's failed-outbox panel and stable retry bytes.

## Item 3: lane TypeScript error

The supplied screen fixes lane to All and has no lane setter. If lane selection is intentionally absent, remove dead filters and use a constant empty-state label. If you retain lane selection, apply:

```diff
-import { disappearLabel, resolveTheme, type ConversationPrefs, type Payload, THEMES, chatTheme } from "../../services/conversation-engine";
+import { disappearLabel, resolveTheme, type ConversationPrefs, type Payload, type Lane, THEMES, chatTheme } from "../../services/conversation-engine";
-const lane = "All" as const;
+const [lane, setLane] = useState<Lane>("All");
```

Wire your lane picker to setLane(nextLane), with nextLane typed as Lane. The existing expression is now valid:

```tsx
lane === 'All' ? 'No messages yet' : `No ${lane.toLowerCase()} messages yet`
```

Do not silence with any, ts-ignore or a cast to string.

## Checks

Run `node --test tests/receive.test.mjs` inside this pack: nine controller tests.
After adapter integration run the repository's typecheck and conversation tests with its existing tsx loader. This pack's tests use simulated storage and do not prove native atomic commits, encryption, React integration, or physical delivery.

Required native checks: read then restart; crash before/during commit and restart; duplicate envelope; changed envelope under same ID; lock/unlock during decrypt; switch accounts/threads; verified key availability retry; tampered envelope remains blocked; read receipt stops before unreadable row. Test on the matching signed dev build, then linked web/desktop. Physical devices were not tested here.
