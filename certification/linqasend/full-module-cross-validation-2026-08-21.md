# LinqaSend full-module cross-validation

Date: 2026-08-21

The three short `Full_Module`, `Full_UI`, and `Production_Code_Pack_1` files are compatibility manifests. They identify the canonical live-source paths and prohibit duplicate payment backends and mock financial data. The substantive comparison source is `LinqaSend_Recommended_Structure_Full_UI_Backend_Code_Pack.txt`.

| Reference area | Canonical implementation | Result |
| --- | --- | --- |
| Recipients and verified Linqa lookup | `recipient-resolver.service.ts`, core and module-surface routes | Implemented |
| Certified external recipients and payout endpoints | migration 036, module-surface routes | Implemented |
| Live FX quotes and corridor pricing | quote, FX pricing, rate repository, v3 capability engine | Implemented; fail-closed without live rates/policy |
| Risk, compliance, KYC, step-up security | v4 security, risk, compliance, readiness | Implemented; fail-closed without certified providers |
| Provider funding/payout and routing | provider contracts/registry/HTTP adapters | Implemented; safe defaults cannot move money |
| Transfer orchestration and state machine | transfer orchestrator and transfer-state | Implemented |
| Double-entry ledger and reversals | ledger service, v4 integrity chain, v5 adjustments | Implemented |
| Signed webhook application and replay defense | LinqaSend routes and webhook verifier | Implemented |
| Reconciliation, safeguarding, treasury | settlement-v5 and operations routes/UI | Implemented |
| Receive money, request money, pay/decline | migration 036, module-surface routes, Expo screens | Implemented |
| Limits and user settings | module-surface routes and Expo controls screen | Implemented |
| Cancel and approval-routed refund | module-surface routes and transfer status screen | Implemented |
| Notifications | durable LinqaSend notification outbox | Implemented |
| Production evidence and exact-release certification | closure-v6 and certification routes/workflow | Implemented |

Mock cards, contacts, exchange rates, successful payments, and static account identities from the reference UI examples were not copied. Runtime controls remain closed until provider, legal, liquidity, corridor, and exact-release certifications exist.

Verification: migration 036 applied; server build, mobile typecheck, and web production build passed; 44 server test files passed with 240 tests passing and 68 pre-existing todo/skipped cases.
