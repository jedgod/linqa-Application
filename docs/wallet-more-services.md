# Wallet More services

The standalone Wallet navigation is Wallet, Activity, Send, More. `/wallet/more`
uses the existing Wallet palette and shared navigation. Funding Methods,
Wallets & Currencies, Transfer Limits (including details), Statements & Reports,
Security & Privacy, and Help & Support use the same shell with fixed navigation.
The Cards shortcut opens `/linqasend/payment-methods`; it does not create another
card-management surface.

Authenticated service metadata comes from `/v2/wallet/services`. Linking is
offered only with write access, a wallet gateway, and the configured token vault.
The existing bank-link flow still performs provider and ownership verification.
Privacy options are filtered by their required account scopes. Country and
currency eligibility continue to come from the existing Wallet profile service.
Display-currency selection is currently unsupported; viewing currencies never
opens a wallet or changes residence.

Wallet limits mirror the wallet money policy, including fees and its shared
rolling-24-hour usage across wallet operations, legacy cash-outs, and sends.
Missing policy limits are shown as unconfigured, never unlimited.

Funding methods and report metadata use authenticated, owner-scoped read
endpoints. Monthly CSV reports cover wallet money operations, including internal
receipts, for a UTC calendar month. They are transaction activity reports, not
certified balance statements. Exports preserve integer minor units and actual
operation statuses, escape spreadsheet formulas, and expose no provider secrets.
Periods over 10,000 operations are refused with an extended-report support
message rather than silently truncated. No financial records are created by
report generation. Downloaded files are removed from the app cache on account
change or when the report screen unmounts.

Validation: `vitest run src/tests/wallet-more-routes.test.ts
src/tests/wallet-v2-routes.test.ts --maxWorkers=1` from `server`, plus the mobile
and server TypeScript checks. Device screenshots are ignored artifacts under
`.runtime/wallet-more/`.
