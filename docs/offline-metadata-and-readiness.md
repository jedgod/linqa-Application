# Offline metadata, isolated tests and readiness evidence

Implemented October 15, 2026, adapting the third supplied implementation proposal.

## Dedicated PostgreSQL security tests

From `server/`, run:

```sh
npm run test:security:chat:db
```

The runner uses Docker Compose v2 and `docker-compose.test.yml`. Each execution creates its own project with a temporary PostgreSQL 18 instance, disposable credentials, a random host port bound only to 127.0.0.1 and tmpfs storage. It waits for readiness, applies the repository migrations through a single PostgreSQL session, and runs the seven chat-security suites with `LINQA_REQUIRE_DB_TESTS=1`. Connection pools and the Compose project are cleaned up on success or failure. The runner never accepts the developer's `DATABASE_URL` as its target.

CI keeps its existing PostgreSQL service in the same job as migrations and tests. The attachment's separate setup/test jobs would not share a database: GitHub-hosted runners are independent machines. The proposed deprecated output command and nonexistent migration commands were not introduced.

CI installs the mobile encryption dependencies before running server tests that exercise the outbox. The API Docker context now uses an allowlist in `server/.dockerignore`, keeping local environment files, installed dependencies, vault data and generated files out of the build context.

## Local metadata encryption

The Expo outbox factory now returns a `ProtectedMobileOutbox` around the existing SQLite adapter. It encrypts complete logical message/media records with AES-256-GCM before they reach the underlying adapter, while replacing account/conversation/device/media lookup fields with domain-separated keyed HMAC indexes. On reads, it authenticates and restores the original records, including the exact E2EE bytes required for idempotent retries.

Encryption uses a randomly generated 32-byte per-account key, stored through the existing native account SecureStore adapter. Provisioning is serialized per account, secure storage is required, and malformed keys fail closed. No password-derived key or Node-only crypto dependency is added to the mobile runtime. The existing Noble AES implementation is used with fresh 12-byte random nonces; its 16-byte GCM authentication tag is appended to ciphertext. Associated data binds the format version, account, record purpose and message ID. Keys are separate from transport E2EE keys and are deleted with their account's secure-storage namespace.

Existing plaintext-identifier outbox rows are migrated per account within an exclusive SQLite transaction. A failed migration rolls back and retains queued messages. Reopening is idempotent. SQLite secure-delete is enabled for future changes. This is field/record encryption, not whole-database encryption or a forensic erase of all historical storage.

Residual exposure remains: message UUIDs, keyed index equality, row counts, queue state, attempt counts, retry/creation timestamps and rejection codes remain visible for scheduling and lookup. SQLite journals, filesystem snapshots and pre-upgrade backups may retain older data. This change does not certify those historical copies as scrubbed. An unlocked or compromised client can still access keys and plaintext.

## Audit enforcement

Run from `server/`:

```sh
npm run security:readiness
```

The verifier requires actual signed evidence; creating a Markdown file cannot mark an audit complete. Set:

- `LINQA_READINESS_PUBLIC_KEY_PEM`: the trusted Ed25519 public key, configured independently from the evidence.
- `GIT_SHA` locally, or `GITHUB_SHA` in CI: the exact source revision being assessed.
- `LINQA_READINESS_ENVELOPE_BASE64`: optional base64-encoded JSON envelope. Without it, the command reads `evidence/product-readiness.json`.

In GitHub, configure repository variables `LINQA_READINESS_PUBLIC_KEY_PEM` and `LINQA_READINESS_ENVELOPE_BASE64`. The API-image readiness job requires this verification for main/tag publication and is a prerequisite of the build/sign job. PR/develop validation does not claim that production-readiness milestones passed.

An authorized assessor must sign the exact UTF-8 payload bytes using Ed25519 and supply an envelope:

```json
{
  "payloadBase64": "base64 of the signed JSON payload bytes",
  "signatureBase64": "base64 of the Ed25519 signature"
}
```

The payload schema is:

```json
{
  "version": 1,
  "revision": "the full Git commit SHA",
  "producedAt": "an ISO-8601 timestamp",
  "milestones": [
    {
      "id": "credential_rotation",
      "status": "PASS",
      "artifacts": [{ "path": "rotation-report.json", "sha256": "64 hexadecimal characters" }]
    }
  ]
}
```

Exactly one passing entry for each required ID is necessary: `credential_rotation`, `offline_encryption`, `integration_tests`, `docker_validation`, `live_audit`. Every entry needs a nonempty artifact reference with a matching SHA-256 digest. Paths are relative to the evidence directory, and realpath checks reject traversal and symlink escapes. Signatures, exact revision binding and a 30-day evidence freshness window are checked. A trusted signature authenticates the assessor's claims; it does not replace the real audit or execution behind those claims.

Use the repository variable to provide an envelope after the commit SHA is known; committing an envelope bound to its own containing commit would create a circular dependency. Reports can already exist in the evidence directory, with their hashes covered by the signed payload. No signing private key or fake completion evidence was generated by this implementation.

## Verification

From `server/`, run `npm run test:encryption`. It runs four Node tests covering GCM authentication/context binding, transparent outbox behavior and signed-evidence integrity, plus four tests exercising the real SQL operations through Node SQLite with mocked Expo bindings. These include legacy migration, rollback on migration failure, reopen, media retries and rejection state handling.

These SQLite tests verify SQL/storage behavior, not Android/iOS native module execution. Physical-device upgrade testing and full live image/audit evidence remain separate release requirements.

Executed locally: all 96 chat security tests passed against the disposable PostgreSQL instance after migrations, with no skips. The runner completed cleanup. The eight encryption/storage/audit tests, server build and mobile typecheck passed. Docker access required execution outside the sandbox; the initial sandboxed attempt failed before creating a container.
