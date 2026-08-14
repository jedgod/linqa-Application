# Dependency Failure Acceptance

- PostgreSQL unavailable: readiness is `503`, liveness remains healthy, and no write reports success.
- Object storage unavailable: vault and attachment operations fail closed; metadata is not finalized.
- Push provider unavailable: ciphertext relay remains independent; tokens are never logged.
- TURN unavailable: privacy-sensitive call modes fail closed unless an explicit fallback policy applies.
- Transparency verification failure: new key trust is blocked and a critical alert is emitted.
- Redis unavailable: cross-node fan-out reports degraded state and clients retain unsent data locally.
