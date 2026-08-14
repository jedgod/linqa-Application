# Linqa Stages 11–15 Acceptance Tests

## VPN
- VPN use does not automatically block login.
- Relay-only mode exposes no host ICE candidates to peers.
- TURN credentials are short-lived.
- Risk score triggers step-up authentication only at configured thresholds.

## Account deletion
- Deletion requires step-up authentication.
- Sessions are revoked immediately.
- User can cancel within the allowed window.
- Deletion job is idempotent.
- Active legal/safety hold blocks deletion.
- Deleted account identifiers cannot remain active.

## Calling
- Recorded video always displays a non-live disclosure.
- Recorded media cannot be used for liveness verification.
- Teleprompter content never leaves the local client.
- Relay-only mode uses TURN.
- End call revokes location grants.

## Retention
- View-once video cannot be reopened.
- Delete-after-view queues deletion.
- Retention override prevents deletion.
- Cleanup workers are idempotent.
- Object storage deletion retries safely.

## Location
- No location is sent without active consent.
- Approximate and city modes reduce precision locally.
- Location payload is encrypted before upload.
- Call end revokes location sharing.
- Foreground-only grants reject background publication.
- Expired grants cannot publish.
