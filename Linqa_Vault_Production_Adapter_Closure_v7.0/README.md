# Linqa Vault Production Adapter Closure v7.0

Purpose: close the remaining provider/repository wiring gap after Vault v6 without weakening E2EE.

## Production invariants
1. Existing Linqa auth/session remains the principal authority.
2. Existing Device Link v2 remains the trusted-device/attestation authority.
3. Vault server stores ciphertext for normal Vault objects and never receives the user's Vault content key.
4. External/social/message/client imports use an isolated pre-encryption quarantine only after explicit user intake.
5. Malware/DLP scan happens in quarantine before client encryption. Device-local files use client-side scanning/encryption.
6. A clean quarantine object is downloaded only with a short-lived one-use handoff grant; client encrypts it and uploads Vault ciphertext.
7. Vault -> Social always creates a new social attachment. No social route receives a Vault storage key.
8. Provider adapters fail closed in production when unset, mocked, unhealthy, or uncertified.
9. Billing webhook verification uses the original raw request body and is idempotent.
10. Release readiness is bound to exact Git SHA + artifact digest + physical evidence.

## Integration map
- PrincipalAdapter -> existing Linqa session middleware
- DeviceTrustAdapter -> linked_devices_v2 / Device Link v2 service
- SocialAttachmentAdapter -> existing social attachment repository
- MessageAttachmentAdapter -> existing E2EE message attachment metadata/ciphertext bridge
- ClientBusinessAdapter -> existing business/client authorization service
- ObjectStore -> S3-compatible quarantine/ciphertext buckets
- Scanner -> ClamAV reference adapter + replaceable enterprise scanner
- DLP -> provider interface; production can require it by policy
- Mail -> SMTP/API provider interface
- Billing -> Stripe-style provider-neutral interface; reference webhook/checkout contract
- SocialExport -> existing social attachment creation service

## Apply
1. Apply `migrations/060_vault_production_adapter_closure.sql` after mapping migration number to the live repo.
2. Implement `LiveLinqaBindings` in `src/live/live-bindings.ts` using existing services.
3. Configure object storage, scanner, mail and billing providers.
4. Register `assertVaultProductionReady()` at server boot.
5. Mount routes and workers.
6. Run `npm run vault:certify`.
7. Run physical device matrix and bind evidence to exact Git SHA/artifact digest.
8. Do not enable `VAULT_PRODUCTION_ENABLED=true` until readiness returns 200.

This pack intentionally does not guess live table names for users/social/messages/billing. The compiler contract makes missing mappings explicit and boot fails closed.
