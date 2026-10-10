# LinqaVault + LinqaSend Biometric Production Closure v2.0–v5.0

**Production target: v5.0.** Apply v2 → v3 → v4 → v5 to an existing v1 installation. For a new environment, use `v5_production_closure/migrations/biometric_v5_consolidated.sql` after adapting the documented foreign-key/principal adapters to the live Linqa schema.

This module intentionally does **not** implement centralized facial recognition. Face ID / Android Class 3 biometric matching stays on the device. A biometric-gated, hardware-backed P-256 key signs a one-time Linqa challenge; the server verifies the signature and may issue a short-lived, one-use, purpose-and-resource-bound grant.

## Versions

- **v2.0 — Repo-native integration:** principal/session adapter, trusted installation/device adapter, algorithm normalization, credential enrollment lifecycle.
- **v3.0 — Transaction binding:** canonical LinqaSend transfer/cash-out resources, immutable authorization snapshot, quote/version/recipient/amount binding, idempotency and replay resistance.
- **v4.0 — Recovery and attack resistance:** credential state machine, revoke-all-device response, recovery epoch, velocity/risk hooks, outbox/audit, stale-grant invalidation.
- **v5.0 — Production closure:** attestation contract, fail-closed production policy, authorization service, Vault and Send middleware, integrity audit chain, workers, monitoring hooks, certification and release gate.

## Absolute invariants

1. Linqa never stores a user's face image/template for this feature.
2. Private keys never leave Secure Enclave / Android Keystore when hardware support is available.
3. The backend accepts only declared supported algorithms and matching key types/curves.
4. Challenges are random, short-lived, single-use and bound to user + installation/device + credential + purpose + resource hash.
5. Grants are short-lived, single-use and bound to the same tuple.
6. LinqaSend authorization is bound to transfer ID, transfer version, amount minor units, currency, recipient, quote ID/version and action.
7. Any material transfer mutation requires a new biometric challenge.
8. Vault grants cannot authorize LinqaSend. LinqaSend grants cannot unlock Vault.
9. Revocation/recovery increments security state so old grants cannot survive account/device recovery.
10. Production attestation/risk/trust adapters fail closed for configured high-risk actions.

## Existing repo integration

Do not create a second Linqa user/session system. `PrincipalAdapter`, `TrustedDeviceAdapter`, `RiskAdapter`, `TransferAdapter`, `VaultPolicyAdapter`, and `AttestationVerifier` are the seams that must be connected to the current Linqa services/tables.

## Release rule

A ZIP or successful TypeScript compile is **not** production certification. v5 may ship only when `scripts/release-gate.mjs` is supplied with real evidence for database migration, iOS physical device, Android physical device, replay tests, transfer mutation tests, revoked-device tests, attestation policy, audit verification, monitoring and rollback.
