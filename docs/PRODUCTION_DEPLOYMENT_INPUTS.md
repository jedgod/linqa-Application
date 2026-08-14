# Production deployment inputs

The repository can build signed API and mobile artifacts and can verify database,
provider, and physical-device evidence. It intentionally cannot create vendor
accounts, legal approvals, signing identities, or production credentials.

Required protected GitHub environments/secrets:

- `EXPO_TOKEN` plus configured EAS Android/iOS signing and store submission credentials.
- `LINQA_API_BASE_URL` for public-release readiness enforcement.
- `LINQA_RELEASE_ARTIFACT_URL`, `LINQA_RELEASE_ARTIFACT_SHA256`, and
  `LINQA_RELEASE_ARTIFACT_TOKEN` for frozen-artifact certification.
- Production API secret `linqa-api-secrets` containing the variables documented
  in `server/.env.example`, including Ed25519 JWT keys, `IP_HASH_SECRET`,
  PostgreSQL, object storage/KMS, APNS/FCM, Twilio/email, TURN, billing,
  CountryLinqa GeoIP, and LinqaSend gateway/webhook credentials.

Deployment order:

1. Build and keyless-sign the immutable API image with `api-image.yml`.
2. On an approved runner with private database access, run
   `node dist/db/migrate.js` from that exact image with
   `LINQA_MIGRATIONS_DIR=dist/db/migrations`. Retain checksum/output evidence.
3. Replace the Kubernetes digest placeholder with the signed digest, deploy, and
   require `/health/ready` plus `/v1/runtime/final-readiness` to pass.
4. Run the G0-G5 and final-release workflows. Physical Android/iOS jobs require
   the configured protected environment and connected certification hardware.
5. Complete independent penetration, privacy/legal, provider, backup/restore,
   failover, accessibility, and store approvals. Attach signed evidence; never
   convert a missing attestation into a synthetic PASS.
