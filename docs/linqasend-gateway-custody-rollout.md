# Existing gateway custody and lookup rollout

Updated October 18, 2026. Source: `LinkaSend-pageCode/Migration 082`.

## Actual deployment result

Migrations `082_linqasend_wallet_subledger.sql` and `083_linqasend_provider_custody.sql` were applied to the database selected by the local `server/.env`. That target identifies itself as **development**, with real money disabled. Both migrations are clean and checksum-verified; the bounded migration planner reports no pending wallet migrations.

The read-only gateway preflight is **not ready** because this environment has no configured `LINQASEND_PROVIDER_URL`, `LINQASEND_PROVIDER_TOKEN`, KMS settings, or active custody accounts. No gateway address, credentials, custody balance, or bank account reference was invented. No external payment, refund, failover, or production deployment was performed.

The deployment configuration location was requested in the conversation. Selecting “existing gateway” identifies the integration interface but does not provide its endpoint or authentication material. The remaining live connection steps depend on those deployment settings.

## Migration 084 — wallet money operations (applied to development)

`084_linqasend_wallet_money.sql` was applied to the same development target, clean, and the migration planner now reports nothing pending. The planner and preflight accept 082–085 only. Post-migration preflight (`docs/evidence/linqasend-wallet-money-preflight-2026-10-18.json`) is **not ready**, with blockers `CUSTODY_ACCOUNTS_NOT_CONFIGURED`, `GATEWAY_NOT_CONFIGURED`, `WALLET_MONEY_LIMITS_NOT_CONFIGURED`, `KMS_NOT_CONFIGURED`. Real money remains disabled; no limits, custody accounts or provider settings were invented. See `linqasend-wallet-money-flows.md` for the operation lifecycle and the extra gateway endpoints (`LINQASEND_MONEY_V1`) it requires.

Additional release step before enabling: insert reviewed rows into `linqasend_wallet_money_limits` for each entity/currency with `active=true`.

## Android configuration review — October 18, 2026

Reviewed `LinkaSend-pageCode/Migration 082/android`, including its hidden GitHub workflow, Compose file, release runbook, Gradle/Fastlane configuration, custody seed, and gateway load test. This folder does not supply the missing custody gateway deployment configuration:

- `docker-compose.linqa-e2e.yml.txt` exposes a development service on port 8080 and names `npm run start:gateway-api`, but provides no gateway implementation, provider URL/token, or KMS settings. No repository package.json defines that script. Its two independent PostgreSQL containers do not configure replication or failover.
- `tests/performance/PerimeterGatewayStress.js.txt` hardcodes `https://linqa-send.com` with an explicitly simulated bearer token. Its `/wallet/balance-summary` and `/wallet/transfer-out` requests are application stress-test examples, not the authenticated custody/lookup contract above. No load test or payout request was sent to that site.
- `.github/workflows/cd-android-release.yml.txt` references Android signing secrets only. Its `AKNOWLOGE_`/`AKNOWLEDGE_` names do not match the Gradle file's `LINQA_RELEASE_*` variables. These are neither provider authentication nor KMS references.
- `db/seeds/production_wallet_baseline.ts.txt` deletes custody registrations and inserts example provider labels and zero balances into a different schema. It lacks regulatory entity IDs, actual gateway account references, and provider balance evidence. It was not executed or converted into active custody registrations.
- The separate Knex PII migration drops a journal reference and adds nullable encryption fields; it does not configure a KMS key or perform encryption/backfill. It was not applied to the immutable SQL subledger.

No endpoint or secret reference from this folder can be safely mapped to `LINQASEND_PROVIDER_URL`, `LINQASEND_PROVIDER_TOKEN`, `LINQASEND_TOKEN_KMS_KEY_ID`, or `LINQASEND_TOKEN_KMS_REGION`. The next input needed is the existing backend gateway's actual deployment environment-file path or secret-manager/deployment reference, plus its approved custody-account mapping. Android signing settings cannot substitute for those backend settings. The development readiness blockers remain unchanged.

## Implemented changes

- Added migration 083 instead of editing migration 082. It adds provider/entity/currency/account-scoped custody registrations, immutable custody observations, immutable coverage-check history, and an entity-scoped customer-liability view.
- Added existing-gateway adapters for capabilities, custody balances, settled receipt lookup, and original-key payout lookup. Monetary values remain decimal minor-unit strings. Redirects are rejected so gateway credentials cannot be forwarded to another endpoint.
- Added custody registration and periodic synchronization through the supervised `wallet-custody` worker. An account becomes active only after the gateway returns a matching fresh balance and the configured entity passes the repository's active/approved/healthy checks.
- Coverage compares combined registered assets against customer liabilities for the same entity and currency. It does not compare every provider separately against the entire liability balance, or mistake an ordinary balance change for evidence that a specific customer payment settled.
- Custody observations more than five minutes old, more than thirty seconds in the future, scoped to another provider/entity/account/currency, or outside the integer range are rejected. Snapshot replay with changed evidence is rejected. Historical observations are never overwritten to hide a discrepancy.
- Withdrawal policy now requires fresh custody coverage before a new payout can be dispatched. Unknown payout reconciliation still performs read-only lookups under its original identity.
- Added reconciliation of recorded payout operations. An accepted payout whose response/reference was lost can be found by its original idempotency key. Explicit settled custody evidence is required before creating an internal wallet receipt. The existing atomic completion service requires persisted completed lookup proof before recovering a transfer stranded in PROCESSING.
- Provider-declared failed payouts create an operations alert for funding reconciliation; the code does not claim that an external funding refund happened.
- Fixed the normal migration entrypoint to pin transactions and advisory locks to one PostgreSQL connection. Added a bounded wallet migration command that refuses unrelated pending migrations, dirty/checksum-mismatched history, and insufficient schema privileges.
- Added read-only readiness reporting, validated custody-account registration, and startup checks for the wallet schema and gateway capability contract.

## Existing gateway HTTP contract

All requests use the configured gateway base URL and Bearer token. The gateway needs these authenticated endpoints:

| Endpoint | Response |
| --- | --- |
| `GET /capabilities/wallet` | Contract version and feature booleans below |
| `POST /custody/balances/lookup` | Matching account scope, balance string, immutable snapshot ID and observation timestamp |
| `GET /custody/receipts/lookup/:encodedPayoutKey` | Settled receipt evidence or JSON null |
| `GET /payouts/lookup/:encodedPayoutKey` | Existing payout status/reference or JSON null |
| `GET /payouts/:encodedProviderReference` | Existing payout status/reference or JSON null |
| `POST /funding/refunds` | Sender-fee refund evidence (see below) |
| `GET /funding/refunds/lookup/:encodedRefundKey` | Original refund evidence or JSON null |

The capability response is:

```json
{
  "version": "LINQASEND_WALLET_V1",
  "custodyBalances": true,
  "custodyReceiptLookup": true,
  "payoutLookupByIdempotencyKey": true,
  "senderFeeRefunds": true
}
```

`senderFeeRefunds` is required by the workers and the preflight (blocker `GATEWAY_SENDER_FEE_REFUNDS_MISSING`) because the app records a sender-fee refund obligation that must be honored.

The custody-balance request contains `providerId`, `regulatoryEntityId`, `currency`, and `accountReference`. The response repeats exactly those fields and adds `snapshotId`, `balanceMinor` (a nonnegative integer string), and `asOf` (an ISO timestamp with timezone). `asOf` describes the authoritative balance observation, not the timestamp of the last customer transaction.

A receipt lookup returns `status: "SETTLED"`, `providerId`, the original public `transferId`, stable `providerRef`, and the `walletCredit` evidence documented in `linqasend-wallet-integration.md`. It must match the original recorded payout and receiving account scope. Missing results never authorize a replacement payment. A transport error or 404 remains an unknown/error condition; the gateway should return JSON null for a successful lookup that found no record.

### Sender-fee refund endpoints (migration 085)

When a sender paid the instant-delivery fee and the receiver chooses the free standard withdrawal, the deposit records `PENDING_REFUND`. The `wallet-fee-refunds` worker refunds that fee only after the withdrawal is `COMPLETED`.

`POST /funding/refunds` request (Bearer authenticated):

```json
{
  "transferId": "public transfer id",
  "fundingProviderRef": "provider_reference of the original FUNDING_AUTHORIZATION",
  "amountMinor": "500",
  "currency": "USD",
  "idempotencyKey": "deposit-fee-refund:<depositId>",
  "reasonCode": "INSTANT_FEE_NOT_USED"
}
```

Response (strict; unknown fields are rejected): `{"status":"REFUNDED"|"PENDING"|"FAILED","providerRef":"...","fundingProviderRef":"...","amountMinor":"500","currency":"USD"}`. `amountMinor` is a positive decimal string. The echoed `fundingProviderRef`, `amountMinor` and `currency` must exactly match the request or the evidence is discarded and the refund is not marked complete.

`GET /funding/refunds/lookup/:encodedRefundKey` returns the same body for a refund submitted under that `idempotencyKey`, or JSON null if the gateway has no record. A repeated `POST` with the same key must replay the original refund, never create a second one.

Worker behavior: the refund amount may not exceed the sender fee charged on the quote, and the funding reference must come from a succeeded funding authorization with the same provider. Once a request may have reached the gateway (`refund_submission_started_at` set), the worker only looks it up by key and never submits again; a null lookup or transport error keeps the row `PENDING_REFUND` and raises an operations alert after 30 minutes. `REFUNDED` is recorded only with provider evidence (enforced by a database constraint). A provider-declared `FAILED`, a missing funding reference, or an invalid amount moves the row to `REFUND_REVIEW` for a person; nothing is retried automatically. This is verified against a loopback HTTP gateway with synthetic records, not a live provider.

The gateway's own partner implementation and credentials must supply these truthful values. Adding the client contract in Linqa cannot create or certify a remote bank integration that is not deployed.

## Configuration and rollout commands

Production Kubernetes wiring is supplied in `deploy/kubernetes-secret-env-injector.yaml`; see `deploy/README-wallet.md` for required Secret keys, full server runtime configuration, workload identity, compiled-image commands, registration and release steps. It defaults to zero replicas and disabled real money. Preparing these files did not provision or alter a cluster or cloud KMS key.

`npm run linqasend:wallet:verify-integration` (from `server`) runs server TypeScript validation and the existing read-only wallet readiness check, emits a local JSON timing/event summary, and exits nonzero if either fails or times out. This adapts the supplied parity/telemetry snippet without React Native dependencies in backend tooling or a misleading table-only success. It does not configure gateway secrets, provision a KMS key, or open listeners. Its readiness check makes authenticated read-only gateway calls only when a gateway is configured. No Sentry event is sent.

Use the actual deployment's protected environment/secret manager for `LINQASEND_PROVIDER_URL`, `LINQASEND_PROVIDER_TOKEN`, `LINQASEND_TOKEN_KMS_KEY_ID`, and `LINQASEND_TOKEN_KMS_REGION`. Production transport must satisfy the existing HTTPS/configuration policy. The KYC, provider certification, custody responsibility, bank/card payout capability, kill-switch, and release/readiness controls also remain enforced.

From `server`:

```powershell
npm run linqasend:wallet:migrate
npm run linqasend:wallet:migrate -- --apply
npm run linqasend:wallet:preflight
```

The first command only plans. The apply command allows only migrations 082–085 to be pending. Neither command changes real-money flags or installs account mappings. Run the plan against the intended target before applying there; the applied target in this task was the local development configuration.

Create a protected JSON manifest using actual gateway-approved account references:

```json
{
  "accounts": [
    {
      "providerId": "REPLACE_WITH_APPROVED_ADAPTER_KEY",
      "regulatoryEntityId": "REPLACE_WITH_APPROVED_ENTITY_ID",
      "currency": "USD",
      "accountReference": "REPLACE_WITH_ACTUAL_GATEWAY_ACCOUNT_REFERENCE"
    }
  ]
}
```

USD above is only an example; set the real account currency. Keep the manifest out of source control if its references are sensitive. Do not put gateway credentials in the manifest or chat.

```powershell
npm run linqasend:wallet:register-custody -- C:\secure\custody-accounts.json
npm run linqasend:wallet:preflight
```

Registration checks live gateway capabilities, validates a live scoped balance, and verifies the financial entity before activating each account. It refuses rebinding the same provider account/currency to another entity. If a multi-account manifest partially succeeds, successful registrations remain audited; correct the failed entry and rerun. Registration is idempotent for the same scope/evidence.

For deployment injection, set `LINQASEND_CUSTODY_MANIFEST_PATH` to the protected manifest's actual path and run `npm run linqasend:wallet:register-custody` without a positional argument. An explicit CLI path takes precedence. Missing paths, invalid manifests, and unavailable gateway configuration fail the command rather than reporting a successful skipped import. There is no assumed `/secure` mount or admin-console importer.

### Follow-up ingestion/adapter/preflight snippet review

The subsequently supplied `apply_live_custody_manifest.ts`, `GatewayHttpAdapter.ts`, and `preflightMonitor.ts` were mapped to the existing registration command, HTTP provider adapter, and wallet preflight. The deployment-injected manifest path was added to the registration command. Separate Knex/Axios implementations were not introduced: the supplied seed uses nonexistent `account_reference`/`is_active` columns and a conflict target absent from migration 083; the implemented columns are `provider_account_ref`/`active`, with uniqueness on provider/account/currency. Its transaction advisory lock is not enclosed in a transaction, and a missing file silently skips registration. The existing registration service instead verifies the real gateway and approved entity, checks scope under a transaction, and preserves immutable evidence.

The existing HTTP adapter already rejects redirects, validates response scope and exact integer strings, and distinguishes lookup errors from missing records. Disabling redirects does not constitute certificate pinning. The supplied adapter's raw Axios error logging could expose request authorization configuration and was not copied. The existing preflight additionally checks both migration checksums, original-key payout lookup capability, KMS presence, custody coverage, and unresolved legacy operations. These snippets still reference externally injected settings rather than providing their values or deployment location.

Once the intended deployment is configured and its release gates are satisfied, its existing worker process runs custody synchronization, payout/receipt reconciliation, and withdrawal processing. Technical preflight success does not by itself authorize enabling real money.

## Reference package adaptations

The supplied code uses a placeholder external provider, parseInt/number money, a second Knex schema, a foreign key to a nonunique correlation field, simulated FX and spread amounts, and local refund credits without external refund confirmation. Its outbox worker edits immutable ledger history and treats HTTP 409 as proof of settlement. Those portions were replaced by existing repository services and explicit provider evidence rather than installed unchanged.

The supplied failover, container, partition-parity, telemetry, and archival examples are separate infrastructure concerns; sample hostnames, images and credentials were not deployed. Wallet-funded Send/FX and automatic external refunds are not activated by this custody/lookup change.

## Verification

- 105 selected server/gateway/security tests passed across 11 files.
- 22 wallet/custody tests passed on a freshly migrated disposable PostgreSQL database.
- Server TypeScript validation passed. The disposable test database and its separate PostgreSQL cluster were removed after validation.
- Migration replay preserved wallet posting counts.
- Local configured target applied 082/083 successfully; a second plan reported no pending changes.
- The sanitized post-migration preflight is saved in `docs/evidence/linqasend-custody-preflight-2026-10-18.json`.

Gateway tests use an actual loopback HTTP server with synthetic credentials and records, not the unconfigured live provider. No bank/provider certification or live-money test is implied by those results.
