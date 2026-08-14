# Linqa Threat Model

## Protected assets

- device identity and message keys
- enrollment credentials and refresh tokens
- message, attachment, backup, and location ciphertext
- social graph and routing metadata
- release signing keys and infrastructure secrets

## Primary threats

- account takeover, stolen devices, and refresh-token replay
- malicious relays, key-package substitution, and message replay
- metadata correlation, push-token theft, and TURN abuse
- malformed protocol input and resource-exhaustion attacks
- insider access and software supply-chain compromise

## Required controls

- device-bound authentication, revocation, and short-lived access tokens
- signed key packages, transparency records, replay protection, and fail-closed core APIs
- encrypted local storage and client-side encryption before transport
- least-privilege infrastructure, secret rotation, audit logs, and signed releases
- privacy-safe telemetry that excludes content and direct identifiers

## Trust boundaries

Clients trust the audited local core with plaintext and private keys. The API,
relay, object store, push providers, and TURN service receive only the minimum
metadata and opaque ciphertext required for delivery. Production readiness
requires an independent review of these boundaries and their deployed config.
