# Linqa Stages 21–30 Acceptance Tests

## Native bindings
- Private keys never enter JavaScript.
- API version mismatch fails closed.
- Core runtime state is explicit.
- Android/iOS/desktop bindings produce identical protocol fixtures.

## Local database
- Database encryption key is hardware-protected where possible.
- Corruption is detected.
- Search tokens reveal no plaintext terms.
- Key rotation preserves readable records.

## Disappearing messages
- Expiry is enforced on every active device.
- Failed deletion is retried.
- View-once content cannot be reopened.
- Retention overrides are visible and auditable.

## Voice notes
- Audio is encrypted before upload.
- Duration and size limits are enforced.
- Server cannot transcode plaintext.
- Expired notes are deleted.

## Usernames and privacy
- Username enumeration is rate-limited.
- Username cooldown is enforced.
- Released usernames remain reserved for 90 days.
- Discoverability settings are honored.

## Key transparency
- Inclusion proof verifies against signed root.
- Consistency proof detects split views.
- Key changes invalidate verification.
- Safety number matches across platforms.

## Interoperability
- Protocol negotiation rejects incompatible clients.
- New optional capabilities do not break older clients.
- Security features cannot silently downgrade.

## Billing
- Duplicate webhooks are idempotent.
- Entitlements expire correctly.
- Subscription status never changes encryption guarantees.
- Billing data contains no message content.

## Abuse defense
- Device reputation influences rate limits.
- Restrictions are appealable.
- No plaintext message inspection is required.
- False-positive controls exist.

## Launch governance
- Rollout percentage is deterministic.
- Kill switch overrides rollout.
- Launch gates require evidence and ownership.
- Rollback is tested before general availability.
