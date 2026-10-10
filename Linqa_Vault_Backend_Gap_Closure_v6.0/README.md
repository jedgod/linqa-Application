# Linqa Vault Backend Gap Closure v6.0

Production-oriented extension for the existing Linqa Vault v1-v5 pack. It closes the backend gaps behind the mobile pages `plans.tsx`, `share.tsx`, `private.tsx`, `security.tsx`, Intake Center and My Files.

## Non-negotiable E2EE rule
Stored Vault payloads remain client-encrypted. The server never receives a Vault content-decryption key. Server-side malware/DLP inspection is permitted only in an explicit **pre-encryption intake quarantine** before the client promotes/re-encrypts the clean content into Vault ciphertext. Direct device uploads are encrypted client-side and therefore use client-side scanning; the server verifies ciphertext integrity/size but cannot claim malware inspection of plaintext.

## Implement in this order
1. Apply `migrations/048_vault_gap_closure.sql` after the existing Vault migrations.
2. Wire adapters in `src/adapters/contracts.ts` to Linqa's real social/message/business/device/auth/billing systems.
3. Mount `createVaultGapRouter()` under `/v1/vault` using the existing authenticated principal middleware.
4. Run `npm test` / integration tests and `scripts/certify-v6.mjs`.
5. Keep every provider adapter fail-closed in production. Do not ship the mock adapters.

## Closed UI gaps
- Storage Plans: checkout/change-plan/entitlement webhook contract.
- Share: Linqa User, Vault-to-Vault, Secure Link, Email and Export-to-Social copy.
- Private Vault: server session bound to biometric step-up, five-minute max session, revoke/lock.
- Security Center: 2FA, trusted devices, login alerts, encryption/integrity/scanner/import/share configuration.
- Intake Center: Social, Message, Client/Business, External Link and Scan Document contracts.
- My Files: imported objects list, folders and tags.
- v5 operations: outbox/reconciliation/health worker entrypoints are wired through interfaces.

## Security boundary
Social may request an authorized copy into quarantine. Vault never exposes an object ID/storage URL to social. Export creates a separate social object after policy + step-up authorization. Secure links use opaque random tokens whose hashes are stored server-side; raw tokens are returned once. Email shares send the secure link, never a raw storage URL.
