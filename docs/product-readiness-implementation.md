# Product readiness implementation

Implemented October 15, 2026, adapting the supplied Python/YAML proposal to Linqa's TypeScript, Rust, Expo and Fastify stack.

The supplied Python SecurityManager was a simulation. Its HMAC function produced an authentication digest, not decryptable encrypted metadata; its deterministic device keys did not provide hardware protection, and its in-memory revocation set did not implement Linqa's session/device lifecycle. These mechanisms were not added. Existing cryptography, JWT verification, persistent device records and encrypted attachment envelopes remain the implementation boundaries.

## Key protection

The conversation gate now requires `OS_PROTECTED` or `HARDWARE_BACKED`. Software-only and unknown protection reports leave messaging locked. Probe failures also keep it locked.

The Rust core currently reports that its software keys require OS wrapping. The mobile session adapter resolves this to `OS_PROTECTED` only after the enrolled keys were loaded through its account store and the native SecureStore adapter reports availability. Web localStorage and unspecified adapters provide no such assurance. SecureStore failures propagate into the locked state. This is an OS storage policy, not hardware attestation: it does not claim non-exportable hardware keys or protection against an actively compromised phone.

## Security validation

Run from `server/`:

```sh
npm run test:security:chat
```

This uses the existing Vitest runner. New tests exercise the actual attachment HTTP routes and realtime WebSocket handshake, including expired/forged tokens, wrong issuer/audience, insufficient scopes, inactive devices, cross-account requests and strict metadata validation. Database adapters isolate these route tests; PostgreSQL integration suites separately exercise SQL behavior, membership and attachment access. The realtime gateway now requires `messages:read` and explicitly excludes revoked devices before registering a connection.

Run from the repository root:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test tests/messaging-gate-security.test.ts tests/secure-core.test.ts
```

For integration coverage, supply an isolated, migrated test database through `DATABASE_URL`. Never point the tests at production. CI provides PostgreSQL and sets `LINQA_REQUIRE_DB_TESTS=1` so an unavailable database cannot silently skip the integration suites.

## Image pipeline

`.github/workflows/api-image.yml` now runs for main/develop pushes, main pull requests, release tags and manual requests. It requires the reusable CI workflow and secret scan to pass before building and scanning the API image. Trivy rejects HIGH/CRITICAL vulnerabilities, including unfixed ones. A runtime packaging check verifies the non-root user and compiled entry point/migrations. Publishing, SBOM/provenance generation and digest signing occur only for main or v* tags; PR and develop builds validate without publishing.

The existing CI workflow now supports `workflow_call`, runs the named chat-security command and runs the mobile key-protection regressions. Image publishing uses the existing `server/` Docker context. No Python runtime, Python requirements file or Bandit scan was introduced for this TypeScript application.

Trivy configuration follows its official action documentation: https://github.com/aquasecurity/trivy-action. Secret scanning uses the existing Gitleaks action convention: https://github.com/gitleaks/gitleaks-action. Organization repositories may require a configured `GITLEAKS_LICENSE` secret.

## Local validation and remaining work

- Chat security command: 43 tests passed; 46 PostgreSQL integration tests skipped because no dedicated database was supplied.
- Mobile key-protection/core regressions: 17 tests passed.
- Server TypeScript build: passed.
- Mobile TypeScript check: passed.
- The broader conversation-engine test file could not load under Node because an existing dependency imports React Native Flow syntax (`Unexpected typeof`). The separate key-protection suite avoids that unrelated runtime dependency. This broader suite is not recorded as passed.
- Local Docker engine access was denied; no local container build, scan or runtime packaging validation was completed. GitHub Actions execution, registry publishing and signing were not performed here.
- Historical release-signing credential exposure still requires real credential/key rotation and confirmation by the release owner. Neither simulated key provisioning nor these code changes revoke exposed credentials.
- Offline database metadata exposure remains: encrypted envelopes do not encrypt all account/conversation identifiers or timestamps in SQLite.
- These changes do not certify every route, live configuration, client, provider or deployed artifact as production secure.

## Follow-up implementation kit

The second supplied attachment was an HTML document containing four code examples. Its useful additions were adapted to the existing APIs rather than installing a parallel demo application or replacing the production authorization contract.

- Added a shared `resolveProtectionLevel` probe and `assertMessagingUnlocked` policy assertion. Both the conversation gate and direct `SecureCoreMessaging.seal/open` calls enforce this policy. Cached plaintext is checked before it can be returned; loss of storage protection also blocks direct calls.
- Extended real HTTP route tests to cover another account's device and reject filename, MIME type and plaintext URL metadata, including empty fields that the example's truthiness checks would miss.
- Extended real WebSocket handshake tests with wrong issuer and audience rejection. Tokens continue to use authorization headers; the example's query-string token mechanism was not introduced.
- Preserved Linqa's `messages:send` scope, membership-based attachment access, coded errors and existing 401/422 responses. The example used different scopes and a standalone owner-only attachment model; replacing the application with those would change its API and chat-sharing behavior.
- Retained the established GHCR repository, immutable SHA tags, least-privilege permissions and existing Trivy action version. The example's Prisma migration paths do not match this server. Packaging checks now validate actual file/directory types at `/app/dist/index.js` and `/app/dist/db/migrations`, with a 30-minute image job timeout.
- The HTML presentation, Google Fonts and copy-button JavaScript were not added to application screens; this attachment was used as an implementation reference.

Follow-up security validation: 50 server tests and 19 mobile/core tests passed. Server build and mobile typecheck also passed. The same 46 PostgreSQL tests require a dedicated database and were skipped locally. Workflow YAML and required dependencies parsed successfully. Live GitHub and Docker validation remain outstanding as described above.

## Third proposal: database, offline metadata and audit evidence

Implemented a dedicated Compose PostgreSQL test runner, AES-256-GCM local outbox record protection with native SecureStore keys and transactional legacy migration, and signed revision-bound audit milestone verification. CI now runs the encryption/verifier tests and requires real signed readiness evidence before main/tag image publication. Detailed commands, evidence format and residual metadata exposure are documented in [offline-metadata-and-readiness.md](offline-metadata-and-readiness.md).

Eight new encryption/storage/audit tests passed. Server build, mobile typecheck, workflow/Compose YAML parsing and source whitespace checks passed. This does not constitute live deployment approval, credential rotation or a completed independent audit.

The dedicated PostgreSQL runner was subsequently executed with Docker access outside the sandbox: all seven chat-security suites passed, 96 tests total, with no skips. Migrations and temporary database cleanup completed successfully. This supersedes the earlier local integration-test skip limitation; live deployment/image/audit claims still require their own evidence.

## Fourth blueprint: persistent sessions and realtime revocation

Implemented centralized active device/session predicates across chat, thread and mobile-hub authorization, mandatory JWT expiration, persistent revocation checks on refresh, live socket authorization and 15-second idle checks, ordered/bounded outbound queues, safe replacement-connection cleanup and an API-specific restrictive CSP. Existing native cryptography, encrypted attachment storage, public authentication endpoints and signed CI publication gates were preserved. Details and limits are in [session-and-realtime-hardening.md](session-and-realtime-hardening.md).

Latest real-database run: nine suites passed, 108 tests, no skips, followed by disposable database cleanup. Forty-one broader auth/authorization tests and eight encryption/storage/audit tests passed; the server build passed. This source-code implementation has not been deployed and is not full production security certification.
