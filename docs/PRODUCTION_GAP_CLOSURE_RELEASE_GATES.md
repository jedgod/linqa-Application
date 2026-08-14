# Linqa Production Gap-Closure Release Gates

## G0 Truthfulness

No required production capability reports READY from database health alone. Production never starts with development delivery providers.

## G1 Identity

Phone verification, device enrollment, recovery-email verification, signed key packages, transparency, and cryptographic single-use step-up must pass.

## G2 1:1 secure messaging

Two fresh clients authenticate, enroll, publish and verify keys, encrypt locally, persist a durable outbox, relay ciphertext only, lease, decrypt locally, and acknowledge. Restart, offline, WebSocket-loss, duplicate, replay, tamper, substitution, expiry, revocation, version, and plaintext-negative cases must pass.

## G3 Native

G2 passes Web-to-Web and Web-to-one-native-platform through UniFFI with OS/hardware-protected keys.

## G4 Providers and migrations

Provider-registry consolidation and clean-install/upgrade migration tests pass.

## G5 External assurance

Independent crypto review, penetration testing, KMS/TLS review, restore and multi-region tests, SLO paging, privacy/legal approval, staffed response, signed native candidates, app-store validation, canary rollback, and formal go/no-go are mandatory.

