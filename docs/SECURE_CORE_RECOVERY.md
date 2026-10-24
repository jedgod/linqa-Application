# Secure Core: intermittent `SECURE_CORE_AUTHENTICATION_FAILED` on cold start

Status: **mechanism established from source and reproduced in tests; fixed and regression-tested.** The single incident on the
phone had no logs, so that exact launch cannot be replayed; it is attributed to this mechanism because the error, the timing
pattern (cold start only, whole thread, intermittent) and the code path all match. Repeated cold starts on the physical device are
recorded in `evidence/stabilization-2026-10-24.md`.

## What was seen

On one cold start of the Galaxy A03s, every message in a conversation showed
"Can't open this message. (SECURE_CORE_AUTHENTICATION_FAILED)". The same messages opened on the launches before and after it.
No JavaScript error and no API rejection accompanied it, and the key material on the phone was intact.

## Root cause

The native secure core refuses to open an envelope it has already opened (replay protection). That is correct and must stay.
Verified in `core/`: the replay cache raises `ReplayDetected` (`core/src/replay.rs`), and `decrypt_message` in
`core/src/uniffi_api.rs` maps **every** error from the core to the opaque `NativeCoreError::AuthenticationFailed`, which the
Android bridge reports as `SECURE_CORE_AUTHENTICATION_FAILED`. So a duplicate open looks exactly like a cryptographic failure.
The phone's core is built with `from_key_material`, whose replay cache is in memory only, which is why messages open normally
again after a restart.
`SecureCoreMessaging.open()` (clients/mobile/services/secure-core.ts) remembered what it had opened in memory, **but only after
the native open finished.** Two callers opening the same message at overlapping times therefore both missed the cache, both reached
the core, and the second was refused as a replay. A replay refusal is reported as `SECURE_CORE_AUTHENTICATION_FAILED`.

Overlapping opens happen on a normal cold start:

1. `ConversationContainer` builds its `ConversationService` from an outbox database that opens asynchronously.
2. When the outbox finishes opening, the service gets a **new identity**, so `useConversation` rebuilds its receiver and starts
   opening every message in the thread again, while the first pass may still be running.
3. The chat-list preview opens the newest message of the same conversation at about the same time.

Whether the first pass finishes before the outbox opens is a timing race, so it failed only on some launches, and when it failed
it failed for the whole thread (the later pass wins the screen).

## Fix

`SecureCoreMessaging` now tracks opens that are **in flight** (`opening`). A caller arriving for a message that is already being
opened awaits that same open instead of reaching the core a second time. Properties, each covered by a test in
`tests/secure-core.test.ts`:

- The core is asked once per message; every overlapping caller gets the same plaintext.
- A genuine failure (bad envelope, wrong device, unknown sender) is shared by the callers waiting on it and is **not cached**: a
  later retry opens afresh. Sharing never turns a failure into a success.
- The same message id with different ciphertext or a different claimed sender is refused (`MESSAGE_CONTEXT_MISMATCH`), never merged.
- An open that finishes after the account scope changed is dropped for **every** waiting caller (`SECURE_CORE_UNAVAILABLE`) and
  nothing is remembered. One account's session never serves another account's messages.

Authentication failures from real decryption remain authentication failures. Nothing resets a ratchet or key, deletes a message,
or retries with other keys.

## What was deliberately not added

A pasted proposal described a new `SecureCoreStartupGate` class. It is not needed here, because the repository already has the
equivalent controls, and a second gate would add a place for state to disagree:

| Proposed | Already in the repo |
|---|---|
| Single-flight initialization | `SecureCoreDevice.ensure()` shares one init promise and does not remember a failure |
| Locked / not-ready refusal | `assertMessagingUnlocked(...)` and `SECURE_CORE_UNAVAILABLE` (fail closed) |
| Account-change protection | `accountScopeGeneration()` / `assertScope()`; sessions cleared on switch |
| Plaintext never delivered after a switch | the post-decrypt `ensure()` rejects when the scope changed |

## Known follow-ups (not required for the fix)

- The rebuilt receiver still re-reads the thread once when the outbox opens. It is now harmless (answers come from the shared open
  or the cache), but it is wasted work and a brief reload. Making the outbox available without changing the service's identity
  would remove it.
- The "opened" cache is memory-only (20,000 entries). After a restart the new core has no replay memory either, so opens succeed
  again. Within one process, an evicted entry cannot be reopened; that would need a persisted plaintext cache, which is a design
  decision (it would put message text at rest) and is intentionally not made here.
