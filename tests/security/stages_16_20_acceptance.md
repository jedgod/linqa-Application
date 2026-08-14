# Linqa Stages 16–20 Acceptance Tests

## Push
- Push payload contains no message text.
- Invalid provider token is retired.
- Revoked devices cannot register or receive push.
- Token values are encrypted at rest.
- Quiet hours are honored.

## Contact discovery
- Raw address-book values never reach the server.
- Discovery query is limited to 500 entries.
- Opted-out users are not returned.
- Query logs contain counts only.
- Results reveal only minimum account identifiers.

## Signaling
- Signaling socket requires a device-bound token.
- Only call participants can send events.
- Duplicate and decreasing sequences are rejected.
- Expired signaling events are not delivered.
- Revoked devices are disconnected.
- TURN credentials expire quickly.

## Trust and safety
- Blocking immediately ends active calls.
- Blocked users cannot create new direct calls.
- Evidence requires explicit user submission.
- Staff actions are audited.
- Moderators cannot access plaintext without submitted evidence.
- Critical reports receive shortest SLA.

## Release and recovery
- Every release includes checksums, SBOM, and provenance.
- Secret scanning passes.
- Artifacts are signed.
- Revoked releases cannot be served.
- Backup restore tests run successfully.
- Disaster-recovery evidence is retained.
