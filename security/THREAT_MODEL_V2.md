# Linqa Threat Model V2

## Trust Boundaries

- Client secure core and platform key store
- Browser and native UI runtimes
- API, relay, authentication, and key-transparency services
- PostgreSQL, object storage, TURN, and notification providers
- Enterprise identity providers and operations staff

## High-Value Assets

- Identity private keys, wrapping keys, sender credentials, and key packages
- Device enrollment proofs, backup keys, vault file keys, and refresh tokens
- Organization policy, legal-hold metadata, and transparency history

## Mandatory Abuse Cases

- Malicious key substitution or malformed hybrid ciphertext
- Replayed enrollment, message, or backup data
- Compromised notification token or malicious object replacement
- Cross-tenant access, release self-approval, or insider audit tampering
- Group epoch rollback and TURN credential harvesting

## Release Blockers

- Missing cross-platform fixtures or negative cryptographic vectors
- Absent hardware-backed key custody on supported mobile devices
- Unverified restore, dependency-failure, and rollback drills
- Plaintext or secret material in telemetry
- Organization isolation failure or fail-open dependency behavior
- Missing independent cryptographic review and penetration test
