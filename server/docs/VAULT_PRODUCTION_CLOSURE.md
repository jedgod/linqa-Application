# Vault production closure (v6.0 + v7.0): what is wired

Source packs: `Linqa_Vault_Backend_Gap_Closure_v6.0`, `Linqa_Vault_Production_Adapter_Closure_v7.0`,
worksheet `APPLY_TO_LIVE_REPO_v7.0.md`. Routes live in `src/routes/vault-intake.ts`.

## v7 mapping worksheet

| Contract | Status | Where |
|---|---|---|
| PrincipalAdapter | **Mapped** to the existing JWT session (`createAuthenticator`) | `routes/vault-intake.ts` |
| DeviceTrustAdapter | **Mapped** to the `devices` table (status, revoked_at, last_seen_at). Not Device Link v2 attestation: no such table exists in this repo | `integrations/vault/live-platform-adapters.ts` |
| TwoFactorAdapter | **Mapped** to `webauthn_credentials` (passkeys). No TOTP exists | same |
| LoginAlertAdapter | **Mapped** to `vault_login_alert_preferences` (the only store for this preference) | same |
| Step-up | **Mapped** to `StepUpService` for `VAULT_EXPORT_SOCIAL`. Private Vault unlock belongs to `routes/biometrics.ts` | same |
| Linqa user lookup | **Mapped** to `usernames` | same |
| Private Vault session | **Delegated** to `BiometricAuthorizationService` (`x-vault-unlock-token`) | `routes/biometrics.ts` |
| social / message / business source | **Not configured**: need a resolver. Social attachments are end-to-end encrypted, so a plaintext copy needs the sender's device | `IntakeAdapters.social`, `.sources` |
| vault ciphertext store | **Not configured** (needs an S3-compatible provider) | `VaultProviders.ciphertext` |
| quarantine store / reader | **Not configured** | `IntakeAdapters.blobs`, `VaultProviders.quarantineReader` |
| malware scanner / DLP | **Not configured** | `IntakeAdapters.scanner` |
| mail | **Not configured** (existing email delivery only sends verification codes) | `VaultProviders.mail` |
| billing | **Not configured**; checkout, raw-body webhook, idempotency and entitlement update are done | `services/vault-billing.service.ts` |
| social export | **Not configured** | `VaultProviders.socialCopy` |

Every unconfigured provider answers 503 for its feature. None is mocked in production code.

## Differences from the packs (and why)

* Confirm no longer moves plaintext into the Vault. `POST /imports/:id/confirm` is kept for deployed clients and now hands the clean copy to the requesting device (same as `/handoff`). The device encrypts and uploads ciphertext, then calls `finalize-ciphertext`. The v6 pack's own E2EE rule requires this.
* The client never supplies a storage key; the server derives it. Social export copies the ciphertext to an unrelated `exports/<random>` key, so Social never sees the object's id or key (a presigned URL always contains its key).
* v6/v7 table clashes resolved in `048_vault_gap_closure.sql` (header explains). `vault_private_sessions` is created but unused: Private Vault sessions are the biometric service's.
* The pack's SQL wrote values its own CHECK constraints reject (`kind='PERSONAL'`, role `VIEWER`, intake state `COMPLETED`, export destination `SOCIAL`); fixed.
* Pack boot check threw whenever production was not enabled, which would stop the whole API. Boot now refuses only when `VAULT_PRODUCTION_ENABLED=true` and a gate fails; otherwise Vault features answer 503 `VAULT_PRODUCTION_DISABLED`.

## Switches and workers

* `VAULT_KILL_INTAKE|SHARING|SOCIAL_EXPORT|BILLING=true` turns a feature off.
* `VAULT_WORKERS=true` starts the quarantine purge (every minute) and quota reconciliation (every 15 minutes), each writing a heartbeat tagged with `RELEASE_GIT_SHA` / `RELEASE_ARTIFACT_DIGEST`.
* `GET /internal/ready/vault` returns 200 only when every machine-checkable gate passes (exact build certified for OBJECT_STORE, MALWARE, DLP, MAIL, BILLING; isolated buckets; fresh worker heartbeats). Physical-device, restore-drill, SAST/DAST and provider certification items in `PRODUCTION_GATE.md` still need real evidence.
* Billing: `VAULT_CHECKOUT_RETURN_ORIGINS` (comma-separated https origins) and `VAULT_PUBLIC_BASE_URL` (secure links) must be set.
