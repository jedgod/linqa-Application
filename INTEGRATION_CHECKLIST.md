# G0-G4 Canonical Integration Checklist

## G0

- Runtime probes perform database, Redis, provider, artifact-digest, relay-table, and transparency-signer checks.
- `secure-messaging` is derived from its exact dependencies.
- Production boot requires every mandatory capability to be READY.

## G1

- Production account creation accepts verified phone registration only.
- Enrollment proof and canonical key-package signatures are verified.
- Key-package responses include package-bound Merkle proofs and signed checkpoints.
- Recovery email follows primary phone verification; revocation terminates sessions, relay access, and realtime connections.

## G2

- Production send persists encrypted envelopes before relay submission.
- Active realtime/poll receive decrypts before ACK.
- Upload interruption and replay state survive restart in account-isolated encrypted IndexedDB.
- The relay rejects plaintext fields and binds leases/ACKs to active devices.

## G3

- UniFFI exposes import/export for OS-wrapped Rust identity material.
- Native custody reports its actual protection level; the Rust core no longer claims OS protection by itself.
- AndroidKeyStore and iOS ThisDeviceOnly Keychain custody adapters are included.
- Device-farm web/native evidence remains mandatory for GREEN.

## G4

- SMS, email, push, and object-storage runtime implementations are registered centrally with operational health checks.
- Migration checksum, dirty-state, advisory-lock, clean-install, and upgrade-matrix checks execute in CI.
- Evidence files are hashed and release promotion verifies every gate at the same revision.

## Required CI secrets

- `LINQA_G1_EVIDENCE_URL`, `LINQA_G2_EVIDENCE_URL`, `LINQA_G3_EVIDENCE_URL`, and `LINQA_G4_EVIDENCE_URL`
- `LINQA_EVIDENCE_TOKEN`
- `LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM`

Missing, unsigned, stale-revision, staging-only, or incomplete evidence fails closed.
