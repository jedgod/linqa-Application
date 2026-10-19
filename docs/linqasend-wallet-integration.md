# LinqaSend wallet integration

Implemented October 18, 2026 from the assessment in `LinqaSendPage.txt` and the reference package in `LinkaSend-pageCode/LinqaWallet`.

Latest update: migration 082 and follow-on migration 083 have now been applied and checksum-verified on the configured development database. Custody synchronization, gateway receipt/payout lookup, and migration/preflight commands were added from the Migration 082 package. Live gateway/KMS settings and custody-account mapping are still absent. See [the current rollout record](linqasend-gateway-custody-rollout.md). The initial implementation history and boundaries below describe the earlier stage.

## Implemented behavior

The existing jurisdiction-scoped wallet accounts now have an append-only customer subledger. Migration `082_linqasend_wallet_subledger.sql` adds journals, postings, withdrawal authorization challenges, recovery fields, and customer-liability reporting. Monetary values cross API boundaries as decimal minor-unit strings and are calculated with BigInt.

Every journal balances within one currency. Database triggers reject journal/posting edits, deletions, truncation, currency mismatches, and appending legs to an already committed journal. They update the account's balance projections within the posting transaction. An available-to-held reservation cannot make a verified wallet bucket negative. Ledger balance equals available plus held; pending is separate. Withdrawable is a view of available funds in this implementation, not another balance to add to the total.

Transfer completion credits a customer wallet only when the authenticated provider supplies explicit `walletCredit` custody evidence. The evidence must match the actual recipient, receiving amount/currency, entity, jurisdiction, and jurisdiction version. The credit journal, completion journal, and transfer status commit together. Repeated completion uses the same receipt identity. A generic completed bank/mobile-money payout never creates a wallet credit.

Withdrawals remain linked to individual verified receipts. A withdrawal request consumes a transaction-bound hardware biometric grant, reserves the gross receipt amount, and inserts its durable operation in one transaction. The authorized snapshot includes destination hash, amount, fee, net payout, currency, delivery option, and release date. Changing any of those details requires a fresh authorization. A successful local biometric prompt without a server-issued grant cannot authorize the request.

The supervised `wallet-withdrawals` worker uses leased claims and fencing tokens. Its stable provider key is `deposit:<withdrawal UUID>`. It resolves encrypted references through the existing token vault. It checks current account, wallet, KYC, destination ownership, provider certification, kill switches, capability policy, and regulated responsibility before dispatch. The receiver's wallet-to-bank/card responsibility is checked independently from the original incoming transfer's authorization. The current path supports an eligible same-country destination with the same provider and currency; it does not invent an FX withdrawal route.

Definitive payout success settles the reservation and records fees; definitive rejection releases it through compensating postings. Network errors, lost responses, and process crashes preserve the hold and enter reconciliation. Recovery uses provider reference or the original idempotency key and never blindly resubmits a possibly accepted payout. An unavailable lookup remains reconciling for operations review. A scheduled operation may be canceled before dispatch, atomically releasing its hold; dispatch and cancellation serialize on the operation row.

Wallet balance and activity endpoints enforce the existing active account/device/session authentication and ownership. The mobile Wallet page under LinqaSend > More displays separate currency accounts, available/pending/held funds, verified receipts, withdrawal status, and refresh/recovery actions. Failed reads show unavailable state rather than a fabricated zero. Receipt withdrawal actions require an explicitly credited wallet receipt.

Projection reconciliation compares balances with immutable postings under wallet locks, skips accounts currently being changed, freezes mismatches, and creates an operational alert. Existing safeguarding/liquidity calculations use the combined liability view, replacing a credited receipt's generic payable with its customer wallet postings to avoid counting the same liability twice. Generic legacy refund execution is blocked for credited wallet receipts because it cannot safely unwind customer wallet holdings or already-paid withdrawals.

## Provider contract

A completed internal receipt must supply this additional field through the configured provider adapter or the existing signed webhook inbox:

```json
{
  "status": "COMPLETED",
  "providerRef": "the-stable-provider-reference",
  "walletCredit": {
    "userId": "recipient-user-uuid",
    "amountMinor": "10000",
    "currency": "USD",
    "regulatoryEntityId": "the-configured-custodian",
    "jurisdiction": "US",
    "jurisdictionVersion": 1
  }
}
```

This is custody evidence from a trusted adapter, not a customer-submittable API field. The HTTP gateway also gains `GET /payouts/lookup/<encoded-idempotency-key>`. It returns the existing payout result or null. A generic gateway error/404 is treated as unknown, never permission to generate a new payout identity. The provider must guarantee idempotency and return definitive, stable terminal statuses for the original operation.

## HTTP surfaces

- `GET /v1/linqasend/wallets`
- `GET /v1/linqasend/wallets/:id/activity`
- `GET /v1/linqasend/wallet-receipts`
- `GET /v1/linqasend/transfers/:id/deposit-options` (existing compatibility path)
- `POST /v1/linqasend/transfers/:id/withdrawal-challenge`
- `POST /v1/linqasend/transfers/:id/deposit` (now requires challengeId and biometricGrantId)
- `POST /v1/linqasend/wallet-withdrawals/:id/cancel`

The mobile client and server withdrawal contract must be released together. An older client cannot bypass authorization by omitting the new fields.

## Reference-package decisions

The package's main subledger migration is empty. Its engine sums balances without a wallet lock, uses JavaScript numbers, sends to a placeholder provider URL, and later changes historical postings. Its webhook sample deletes reservations, supplies a default signing secret, and signs reconstructed JSON. Its partition migration drops the ledger table. Its balance UI includes simulated rates/fees and default zero/USD values after errors. Its cache key is not account-scoped; the log encryption example defaults to a zero key. Those implementations were not installed as production code.

The useful reservation/outbox/reconciliation ideas were adapted to the repository's Fastify routes, PostgreSQL SQL migrations, existing raw-byte authenticated webhook inbox, provider adapters, KMS token vault, biometric grants, operational alerts, and Expo navigation. The reference deployment/cron, sample credentials, production smoke requests, native manifests, external incident notifications, and destructive partition migration were not executed or deployed.

## Rollout and boundaries

Apply migration 082 through the normal migration runner in an authorized deployment, then deploy the matching server, worker and mobile build. No application/production database migration or real-money flag change was performed during implementation. Testing uses a separate disposable database.

Existing wallet columns are not accepted as evidence of funds. Accounts with existing nonzero balances require an audited reconciliation/import process. Old transfers and old withdrawal rows are not automatically backfilled, credited, or dispatched. Zero legacy placeholders become subledger-enabled only through a verified receipt. No synthetic opening money is created.

Production remains dependent on provider custody confirmations and lookup support, configured KMS, certified bank/card payout capability and custody responsibility maps, fresh worker readiness, current KYC, and physical-device biometric verification. No real provider payment was executed in this task.

This change does not enable wallet balances as a funding option in the existing Send/FX flow, pooled/partial withdrawals, or cross-entity/cross-currency wallet migration. The reference Send form only simulates those transfers. Connecting wallet funding to Send requires the existing quote, risk, limits, capability, authorization and execution pipeline to support that funding mode; it must not be implemented as a direct balance edit. The current receipt-linked withdrawal design keeps that unsupported option unavailable.

Wallet refunds/chargebacks after credit require a dedicated provider-confirmed custody recovery workflow. The unsafe generic refund path now refuses them. Standard-delivery sender-fee refunds remain explicitly pending/requested until a provider-confirmed refund mechanism processes them; the UI no longer claims that request has already been paid.

## Validation

The test runner `scripts/run-wallet-db-tests.mjs` creates, migrates, and removes a uniquely named disposable database on loopback PostgreSQL. It refuses a remote database host and never runs migrations against the configured application database. Example with an explicitly chosen local test administrator URL:

```powershell
$env:DATABASE_URL = 'postgresql://test_admin@127.0.0.1:5432/postgres'
node --import ./server/node_modules/tsx/dist/loader.mjs scripts/run-wallet-db-tests.mjs
```

Database coverage includes concurrent receipt replay, exact currency amounts, custody-scope mismatch, absence of custody evidence, insufficient funds under competing reservations, authorization rollback, duplicate withdrawal choice, accepted payout with lost response, definitive rejection, expired dispatch lease, standard release timing, immutable/balanced journals, authorization-resource scope/expiry, and projection drift. Unit and regression suites cover provider controls, fees, existing route surfaces and CVV behavior. Server and mobile TypeScript checks are also run.

These checks do not replace bank/provider certification, load testing, release-device rendering, native biometric hardware tests, or live safeguarding/reconciliation evidence.

Completed local results: 99 selected server regression/security tests passed across 10 files; 18 wallet integration tests passed against a freshly migrated disposable PostgreSQL database; 12 mobile money-validation/tracking utility tests passed. The disposable database was removed and the separate local PostgreSQL cluster was stopped and removed after validation. The application database was not used for these tests.
