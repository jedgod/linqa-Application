# Milestone 3 Acceptance

## Multi-device
- User A trusted on Device A1/A2/A3.
- Device A2 approved by A1.
- Device A3 revoked.
- Revocation propagates to sessions and transparency view.

## Multi-user
- User A, B, C exchange messages across at least 5 devices.
- Per-device sync cursors remain independent.
- No duplicate messages after reconnect.

## Group MLS
- Group created with A/B/C.
- B adds a new device.
- Membership commit increments epoch exactly once.
- C leaves.
- Removed member cannot decrypt new epoch messages.

## Key transparency
- Every trusted device has an inclusion proof.
- Client UI shows verified/unverified state.
- Tampered leaf hash fails verification.

## Push
- iOS production APNs token receives wake-up.
- Android production FCM token receives wake-up.
- Push contains no plaintext message body.

## TURN
- At least two regions configured.
- Primary failure routes new calls to secondary.
- Relay-only call does not silently switch to direct P2P.

## Attachments/CDN
- Ciphertext uploaded.
- Signed URL user/conversation scoped.
- URL expires.
- Unauthenticated download is denied.

## Enterprise
- Production SSO login passes.
- SCIM provisioning is organization-scoped.
- Managed-device policy blocks untrusted device.

## Billing
- Webhook signature verifies.
- Duplicate webhook is idempotent.
- Same webhook ID with altered payload is rejected.
- Entitlement state reconciles.

## Emergency
- Tier 1 trusted contacts notified.
- Unacknowledged event escalates according to policy.
- Unauthorized user receives nothing.

## Scale
- Relay load test meets p95/p99 thresholds.
- PostgreSQL/Redis/push/TURN/CDN failure scenarios pass.
- Canary release auto-rolls back when threshold exceeded.
