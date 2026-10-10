# Mobile API mapping

- `plans.tsx`: existing `GET /v1/vault/plans`; add `POST /v1/vault/billing/checkout`. Provider webhook is mounted outside normal JSON parsing.
- `share.tsx`: `POST /share/linqa-user`, `/share/vault-to-vault`, `/share/secure-links`, `/share/email`, `/exports/social/authorize`, `/exports/social/:grantId/execute`.
- `private.tsx`: obtain biometric proof from `services/biometric-session`; `POST /private/unlock`; keep returned session only in memory; auto-call `/private/lock` at <=5 minutes/background/logout.
- `security.tsx`: `GET /security-center`, `PUT /security-center/login-alerts`.
- Intake: `POST /imports/social|message|client|external_link|scan_document`, then process/status. Clean plaintext must be re-encrypted on device before `finalize-ciphertext`.
- `My Files`: `GET /files?workspaceId=...` returns only encrypted metadata + tags + object IDs; clients decrypt metadata locally.

## Device upload
Do not send plaintext to the server merely for scanning. Scan on-device where available, encrypt locally, upload ciphertext through the existing upload-session service, and attach a client scan attestation as advisory metadata. High-risk file types may be blocked from direct device upload by policy or forced through explicit quarantine intake.
