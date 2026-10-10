# Integration contract

The pack deliberately does not invent Linqa's live principal table. Adapt `PlatformPrincipalAdapter` to the existing authenticated `req.user`/session principal and use the existing PostgreSQL pool.

Expected platform dependencies:
- Express-compatible router
- PostgreSQL `pg` Pool/PoolClient
- authenticated principal containing stable user ID
- existing audit/telemetry can be bridged to the included interfaces
- object storage adapter (S3/MinIO/provider) implements `ObjectBlobStore`
- malware/DLP provider implements `ContentScanner`
- billing provider implements `BillingProvider`
- step-up/passkey service implements `StepUpVerifier`

Security invariants:
1. No endpoint accepts owner/user IDs from the client as authority.
2. Tenant/workspace membership is resolved server-side.
3. Object keys are generated server-side and never expose raw bucket paths.
4. Unscanned intake remains QUARANTINED.
5. Export always checks policy + explicit grant + optional step-up.
6. Private objects require an unexpired step-up session.
7. Quota reservation is transactional to prevent concurrent over-allocation.
8. Idempotency keys are mandatory for mutation paths that may retry.
