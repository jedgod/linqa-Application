# Live repo mapping worksheet
Do not merge until each row has a concrete existing implementation.

| Contract | Existing Linqa authority to map |
|---|---|
| PrincipalAdapter | Express auth/session middleware |
| DeviceTrustAdapter | Device Link v2 linked device + attestation service |
| TwoFactorAdapter | existing account MFA/passkey/TOTP status |
| LoginAlertAdapter | security notification preferences/events |
| social source | CountryLinqa/social attachment repository |
| message source | E2EE attachment relay/repository |
| business source | business/client workspace authorization |
| vault ciphertext | current encrypted Vault item repository |
| social export | social attachment creation service |
| billing | selected production billing provider |
| mail | selected production mail provider |
| object store | production S3-compatible storage |
| malware | production ClamAV/enterprise scanner |
| DLP | business DLP provider/policy engine |

## Required route reconciliation
Keep current mobile contracts where already shipped:
- GET /v1/vault/plans
- GET /v1/vault/items
- GET /v1/vault/integration-status
- POST /v1/vault/imports/social
- GET /v1/vault/imports/:id/status
- POST /v1/vault/imports/:id/confirm

Add aliases/adapters rather than breaking deployed clients. New internal scan/handoff endpoints may be hidden behind the existing status/confirm workflow.
