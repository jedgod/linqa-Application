# G5 GREEN Label Rules

G5 is GREEN only when every required check in G5-A through G5-K is GREEN for the exact release version and Git revision.

- G5-A/B/H/K require independent evidence; Linqa or its CI cannot self-attest those reviews or approvals.
- Every evidence artifact is copied into an immutable registry and verified by byte length and SHA-256.
- The complete assurance payload must have a trusted Ed25519 signature, a production-equivalent or production environment, and a validity period of no more than seven days.
- All 11 sub-gates must contain the exact declared check set. Extra, missing, optional, failed, or unreferenced checks are rejected.
- G0-G4 must be GREEN at the same revision before production GA admission.
- Missing device, provider, DR, resilience, external-review, privacy, app-store, or human-approval evidence fails closed.

Code cannot replace an independent cryptographic review, penetration test, privacy/legal approval, incident exercise, store review, or formal go/no-go decision. It verifies and preserves those artifacts as release-blocking evidence.
