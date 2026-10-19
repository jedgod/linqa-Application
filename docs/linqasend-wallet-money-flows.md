# Linqa wallet money-flow assessment

Assessed October 18, 2026 from current mobile and server source. This is a code-path assessment, not a live bank/provider test. No payments or configuration changes were made. The latest executed development preflight remains blocked by missing gateway/KMS configuration and active custody mappings; real money is disabled. Prepared production manifests are not activation evidence.

## Update — October 18, 2026: migration 084 implementation

The "Missing" rows in the map below describe the pre-084 baseline and are kept as the original assessment. Migration `084_linqasend_wallet_money.sql` and the `wallet-money` service/routes now implement amount-based operations of kind `TOPUP`, `WITHDRAW`, `INTERNAL` (wallet to Linqa user) and `EXTERNAL` (wallet to outside recipient, including FX), plus provider-hosted bank linking, returns and refunds. Verified by 43 PostgreSQL integration tests (partial withdrawals, opposing internal transfers, settled top-ups, external FX payouts, refunds, cancellation, lost-response recovery) and 37 unit tests, all passing.

Lifecycle: quote (server-owned amount, fee, FX, expiry) -> biometric challenge bound to the exact snapshot, device, session and installation -> submit (atomic hold) -> durable leased worker -> provider execute/lookup by original idempotency key -> settle, release, or return. Unknown outcomes keep the hold. An expired or unused authorization can be resolved via `POST /v1/linqasend/wallet-money/quotes/:id/resolve`, which cancels the quote atomically so the app's pending action cannot stick. Refund requests are separately idempotent and bounded by the original operation; return/refund amounts are cumulative and monotone.

Fail-closed controls: no row in `linqasend_wallet_money_limits` (per-operation and daily, per entity and currency, `active=true`) means no new operation; bank linking requires `ownershipVerified` plus per-method `funding_enabled`/`payout_enabled` evidence; challenge and submit require `LINQASEND_REAL_MONEY_ENABLED=true`; hosted bank-link URLs must be HTTPS on the gateway's origin.

Not claimed: no live gateway, bank, or provider has exercised these flows. The gateway must implement the `/wallet-money` endpoints (`capabilities`, `quotes`, `operations`, `operations/lookup/:key`, `refunds`) and `/bank-links` (`POST`, `GET /:id`) with capability version `LINQASEND_MONEY_V1`.

Sender-fee refunds (migration 085): the previously unfulfilled `PENDING_REFUND` state is now executed by the `wallet-fee-refunds` worker through `POST /funding/refunds` once the standard withdrawal completes. It is idempotent by `deposit-fee-refund:<depositId>`, recovers lost responses by lookup without resubmitting, requires provider evidence echoing the funding reference, amount and currency, and sends provider-declared failures to `REFUND_REVIEW`. See the gateway rollout doc for the contract. Verified against a loopback gateway only.

## Current capability map (pre-084 baseline)

| User action | Current implementation | Assessment |
| --- | --- | --- |
| Receive a Linqa transfer into wallet | Trusted completion/receipt evidence creates an immutable receipt credit | Implemented, deployment dependent |
| Receive an ordinary direct bank/mobile-money payout | Provider pays the external destination | Does not credit Linqa wallet |
| Add money from own bank/card to wallet | No dedicated top-up intent, funding-to-custody settlement flow or mobile action found | Missing |
| Receive bank transfer into a personal wallet account number | Receive screen shows Linqa identity; no assigned deposit-account/inbound bank settlement flow found | Missing |
| Add/link a personal bank account | Payment-method registration exists; current non-card UI asks for provider reference | Partial onboarding, not a money load |
| Withdraw received wallet money to own bank/debit card | Receipt-scoped, full-receipt reservation and asynchronous payout | Implemented with restrictions; deployment dependent |
| Withdraw a chosen amount from total wallet balance | No amount-based wallet withdrawal API/UI | Missing |
| Send to Linqa user using bank/card funding | Existing transfer flow charges a verified provider method; receiving wallet requires custody evidence | Conditional existing send path |
| Send to Linqa user using wallet balance | No wallet selection/reservation/debit in Send | Missing |
| Send outside Linqa using bank/card funding | Existing recipient, quote, authorization, funding and payout flow | Conditional existing send path |
| Send outside Linqa using wallet balance | No wallet-funded Send path | Missing |
| Convert wallet currency, move across entities, automatic wallet refunds | No completed money lifecycle for these flows | Missing/unsupported |

## 1. Receiving and loading the wallet

Current flow: sender's verified payment method -> provider funding authorization -> provider payout/settlement -> authenticated wallet-credit evidence -> recipient receipt journal -> available wallet balance.

`WalletLedgerService.creditReceipt` verifies positive exact amount, currency, actual LINQA_USER recipient, active user, regulatory entity, jurisdiction and jurisdiction version. It creates/selects the scoped wallet, refuses nonzero unverified legacy balances, and writes AVAILABLE against CUSTODY_CLEARING. Completion and receipt credit share a transaction. Replay of the same receipt is idempotent; changed evidence is rejected. Lookup reconciliation can recover a completed internal payout only with matching settled receipt evidence.

An ordinary transfer status of COMPLETED is insufficient to create wallet money. External bank/mobile-money payments do not create a customer wallet credit. Provider balance snapshots prove aggregate coverage; they do not identify an individual customer's incoming payment. CUSTODY_CLEARING is an accounting contra leg, not itself evidence of an external bank balance.

The current verified receipt goes directly into AVAILABLE. Although PENDING is displayed and exists in the ledger model, no dedicated provisional incoming bank/top-up lifecycle was found. Do not represent pending bank funding as spendable settled funds.

The Receive screen exposes verified identifiers and a preferred funding-source summary. It does not assign bank deposit details or route an inbound bank payment. The phrase “preferred funding destination” blurs a funding source with a receipt destination.

Recommendation: add a distinct Add money operation with server-owned amount/currency/wallet scope, verified source ownership, stable provider identity, and a durable lifecycle. Credit only after authenticated matching custody settlement; represent authorization, pending settlement, failure and returns separately. Bank push deposits need actual provider-assigned account/reference routing and unmatched/duplicate/returned deposit handling. Never top up from a client success response or a synthetic transfer-to-self shortcut.

## 2. Personal bank account: linking versus loading

Linking stores a tokenized payment instrument. It does not move money. The current non-card mobile form asks the customer to paste a provider reference and optional last four digits; this is not a complete consumer bank-linking experience. Setup/confirmation routes exist, but bank ownership verification and payout eligibility still need truthful provider evidence.

Loading the bank from the wallet means a withdrawal. Loading the wallet from the bank means a top-up. Present those as separate actions. Do not imply that every bank eligible for funding also supports payouts. The withdrawal policy requires a verified owned bank/debit method, matching provider, same-country jurisdiction and configured capability/responsibility. Provider-backed account-holder and payout-capability evidence must be validated in the intended integration before claiming a live personal-bank flow.

Recommendation: implement provider-hosted bank linking, distinguish funding-enabled from withdrawal-enabled methods, show bank/name/last four and verification state, and offer an actionable setup path when no compatible destination exists.

## 3. Wallet withdrawal to own bank or debit card

Current flow: choose a specific verified received transfer -> choose verified bank/debit card and instant/standard option -> server snapshot and device/session-bound biometric authorization -> reserve full receipt from AVAILABLE to HELD -> durable leased worker -> provider lookup/completion -> settle HELD into payout clearing and any fee revenue.

The worker rechecks current user/wallet/KYC, legal/corridor responsibilities, provider certification, kill switches and fresh custody coverage before dispatch. Unknown outcomes retain the hold and reconcile using the original provider reference/key. Known failure releases funds. Cancellation is allowed only before dispatch. These are useful foundations.

Restrictions: no arbitrary amount, split receipt or pooled withdrawal; one current withdrawal choice per transfer; destination provider must equal receipt provider; same-country/same-currency routing is required by current policy. Two receipts of 40 and 60 do not support one chosen withdrawal of 50. Users must withdraw the receipts separately.

Standard scheduling is three business days on the existing Eastern calendar. The date is a worker release date, not proof of bank arrival. Instant means eligible for immediate dispatch, not guaranteed immediate bank receipt. The scheduled success copy currently says funds “will be deposited on” a date, overstating the implemented guarantee. Fees are calculated by existing application rules, not proven live provider quotes.

Important gap: a sender-paid fee refund is stored as PENDING_REFUND when the receiver chooses standard withdrawal. No consumer of that status/refund execution was found in the reviewed LinqaSend services. Do not count that refund as completed or promise automatic delivery. Implement a separately idempotent external refund operation and confirmation, or remove the unfulfilled promise.

Recommendation: replace transfer-scoped withdrawal entry with wallet + chosen amount + destination + server fee/arrival quote. Keep receipt links for audit/provenance, not as the spending unit. Retain atomic holds, transaction-bound authorization, durable operation identity and unknown-outcome behavior. Add bank return/reversal handling and customer notifications.

## 4. Send to another Linqa user

The existing Send page selects a verified external payment method. The backend requires paymentMethodId, resolves its provider reference, authorizes external funding and submits a payout to the Linqa recipient. Only explicit custody receipt evidence credits the receiver. It does not reserve or debit the sender's wallet, even if that wallet has sufficient funds. Country/capability enum support for LINQA_BALANCE does not establish a working wallet funding rail.

Recommendation: add an explicit wallet funding choice and dedicated execution branch. For a permitted same-currency, same-custody-entity transfer, atomically debit the sender and credit the recipient once under stable transfer identity, with deterministic account lock ordering, balance checks and biometric authorization. Any fee needs a balanced leg. Do not call external funding to charge the sender again. Different entities/currencies need a separately configured settlement/FX flow, not an unexplained internal balance adjustment.

## 5. Send outside Linqa

The current external flow uses a verified bank/card payment method and provider payout to the selected external destination. It is separate from wallet withdrawals. A balance shown in the wallet cannot currently fund that Send. External destination options remain dependent on actual mobile onboarding, provider and corridor support; backend type names alone do not guarantee all delivery rails work.

Recommendation: wallet -> chosen external recipient -> amount/fee/FX quote -> policy/biometric authorization -> atomic wallet hold -> provider payout under durable identity -> settle or release. Total debit must include the correct fee and source currency; recipient amount and currency must be explicit. Reuse withdrawal recovery principles without labeling a third-party remittance as a personal-bank withdrawal. Address payout failure, bank return, chargeback and refund evidence before release.

## Priority and acceptance criteria

1. Correct product promises now: distinguish Receive, Add money, Withdraw and Send; state wallet balance cannot yet fund Send; fix scheduled-arrival wording and unresolved fee refund messaging. Do not advertise unavailable rails.
2. Complete production readiness with actual gateway/KMS/custody configuration and release evidence. Run compiled preflight, real KMS access validation and a controlled end-to-end provider scenario; source tests alone do not verify bank settlement.
3. Build amount-based personal-bank withdrawal and complete bank onboarding. Test partial/pooled withdrawals, incompatible accounts, concurrent reservations, unknown outcomes, cancellations and returns.
4. Add same-entity wallet-to-Linqa Send with atomic two-customer postings. Test insufficient balance, duplicate requests, concurrent opposing transfers and no second external funding charge.
5. Add bank/card wallet top-ups and wallet-funded external Send as distinct, fully reconciled operations. Cover duplicate settlement callbacks, delayed/returned funding, payout ambiguity, fee/FX accounting, and external refunds.

Accounting acceptance: every change has a balanced immutable journal; customer liabilities reconcile by custody entity and currency; external evidence identifies the specific operation; money values remain integer minor units; restricted routes cannot bypass policy; unknown results never release a hold or trigger a replacement payment blindly.

Primary source evidence: `server/src/services/linqasend/wallet-ledger.service.ts`, `atomic-completion.service.ts`, `deposit.service.ts`, `deposit-options.ts`, `withdrawal-policy.ts`, `transfer-orchestrator.service.ts`, `provider-payout-reconciliation.service.ts`; `server/src/routes/linqasend/wallet-routes.ts`, `routes.ts`, `module-surface-routes.ts`; mobile `wallet.tsx`, `receive.tsx`, `deposit.tsx`, `select-payment.tsx`, `payment-methods.tsx`.
