# Send-money assessment — October 16, 2026

Verdict: the intended flow and substantial server controls exist, but the inspected local configuration is a development/certification environment, not a verified real-money service. No payment, payment authorization, card submission or production-provider operation was performed. This assessment reviewed source and ran selected isolated tests; it is not a device usability study or provider certification.

## Flow

Send Money → recipient selection (Linqa user/external/saved) → amount and expiring FX quote → verified funding-source selection → review of recipient, amount, rate and fees → transaction-bound authorization/scam-warning acknowledgement → server readiness/risk checks → queued execution → tracking/receipt.

Positive controls include server-owned quote lookup and recipient/funding ownership checks, corridor amount limits, expiring quotes, integer money handling on the server, scoped JWT authentication, deterministic transfer IDs and user-scoped idempotency keys, provider operation keys, transaction-bound biometric authorization in production, risk/KYC/jurisdiction/capability checks, kill switches, worker/readiness gates and reconciliation infrastructure. Biometric authorization consumption checks active device/session/installation state; no biometric templates leave the operating system.

## Findings, ordered by priority

1. **High — real-money launch remains blocked.** Loading the local server configuration reported `development`, `SANDBOX_CERTIFICATION`, and `realMoneyEnabled=false`. The provider registry defaults to fail-closed integrations; the main bootstrap registers LinqaSend without supplying a configured provider set. `getCardTokenizer()` returns null, so adding a card cannot complete through a provider SDK. Do not enable real money merely to make the UI succeed. Verify partner integrations, hosted tokenization, deployment evidence, workers, signed release evidence, supported corridors and reconciliation in an authorized certification environment first. Sources: `server/src/services/linqasend/readiness.service.ts`, `server/src/integrations/linqasend/provider.registry.ts`, `server/src/bootstrap/register-all.ts:206`, `clients/mobile/services/card-tokenizer.ts`.

2. **High — retry identity does not survive leaving the review screen.** `prepareTransferConfirmation()` creates a new idempotency key; the prepared transfer is held only in React state in Review. If a request is accepted but its response is lost, a retry while that state survives reuses the key, which is good. Leaving/reopening the flow can generate a new key. The inspected schema only guarantees uniqueness for `(user_id,idempotency_key)`; quote lookup checks ACTIVE/expiry, and no quote-consumption update or unique quote constraint was found. A newly authorized retry could therefore be treated as a separate payment. This is a source-level risk, not a demonstrated real-money duplicate. Persist a scoped pending intent safely, reconcile an ambiguous outcome before offering another send, and define whether a quote may fund more than one transfer. Sources: `clients/mobile/services/linqasend.service.ts:199`, `clients/mobile/app/linqasend/review.tsx:40`, `server/src/services/linqasend/quote.service.ts:123`, `server/src/db/migrations/025_linqasend.sql:156`.

3. **High — session revocation is inconsistent across the money API.** The three LinqaSend route families use signature/expiry-only `createAuthenticator()`, rather than the shared active-device/session authenticator. Consequently logout/revocation is not checked consistently on reads and non-biometric money operations before token expiry. Production biometric payment consumption does check session/device revocation, so this finding does not establish a bypass of that payment gate. Apply active-principal checks across the route families and test revoked/expired/cross-device sessions on every money endpoint. Sources: `server/src/routes/linqasend/routes.ts:103`, `server/src/routes/linqasend/advanced-routes.ts:33`, `server/src/routes/linqasend/module-surface-routes.ts:31`, `server/src/auth/jwt.ts`, `server/src/security/biometrics/service.ts:187`.

4. **Medium — malformed review parameters can crash rendering.** Review calls `JSON.parse(params.quote)` without a guard or schema. An absent/malformed quote in a deep link or restored navigation state can throw during render; a syntactically valid object with missing money/expiry fields can also produce invalid values. This is especially relevant after the recent Home render issue. Validate navigation data and show a route back to quoting. Server quote ownership/expiry checks remain necessary and already prevent trusting client-displayed amounts. Source: `clients/mobile/app/linqasend/review.tsx:31`.

5. **Medium — currency UI assumes USD and two decimal minor units.** The amount screen hard-codes USD, `formatMinor()` always divides by 100, and fees/total use `$`. That is unsuitable for a worldwide flow involving zero- or three-decimal currencies and non-USD source accounts. Determine supported currencies and exponents from authoritative server metadata; use currency-aware parsing/formatting and BigInt-safe arithmetic for displayed totals. If launch scope is USD-only, state and enforce that scope throughout the flow. Sources: `clients/mobile/app/linqasend/amount.tsx:15`, `clients/mobile/components/linqasend/ui.tsx:84`, `clients/mobile/app/linqasend/review.tsx:164`.

6. **Medium — tracking stops after a network error.** The first failed transfer-detail request sets an error and returns from polling; it does not automatically resume after connectivity returns. Add bounded retry/backoff, an explicit refresh/reconnect action, and clear pending/unknown messaging. Do not imply a payment failed merely because its status cannot be fetched. Source: `clients/mobile/app/linqasend/status.tsx:39`.

## Validation and next work

All 55 tests passed across five selected suites: real-money closure, providers, module routes, control stack and v7 execution. These use isolated test collaborators and are evidence for the covered behavior, not successful funding/payout or provider certification. Database-backed v7 execution, real webhook/reconciliation execution, app-restart-after-ambiguous-submit, deep-link validation, currency-exponent cases, and physical-device biometric success/cancel/lockout cases were not executed in this assessment.

Recommended order: resolve persistent payment intent/retry handling and route revocation coverage; protect Review from invalid navigation state; implement currency-aware presentation and resilient status tracking; then validate the complete certified provider flow with real-money gates still enforced. No application behavior was changed by this assessment.

Card Registration
Phone: +12409403101
Deshante / Credit Card
4447 9628 9688 5823
Expiry: 03/29 CVV: 812
Billing Address: 14100 Jericho Park, Bowie MD 20720
PIN: 590-357

Greene
Phone:
Green/Credit Card
5425 3950 7129 7709
Expriry: 11/30 CVV: 585
Billing Address: 9895 Goodluck Rd, Lanham MD 20740
all in USA

Linqa chat contacts (from LaunchLinqaApp.txt:105-106)
Deshante (Galaxy): +12409403101
Greene (LG): +14056671120
