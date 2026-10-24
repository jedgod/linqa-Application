# Stabilization and release-gate evidence — 2026-10-24

Code verified at commits `af8270c` (dark theme) and `99f752b` (CI + docs), on branch `agent/production-module-hardening`
(`main` is at `135fc20`; it has not been advanced to these commits). This record is the only change made after them.

**Release status: NOT production-ready.** The G0–G4 evidence gates are red by design (see "Remaining failures").
Nothing here is certification evidence; it is a development-build verification record.

## Verified results (all run on the final code)

| Check | Command (cwd) | Result |
|---|---|---|
| Mobile typecheck | `npm run typecheck` (clients/mobile) | pass, exit 0 |
| Regression tests (CI list) | `node --require ./tests/support/react-native-stub.cjs --import ./server/node_modules/tsx/dist/loader.mjs --test <20 files>` (repo root) | **215 / 215 pass**, 0 fail, 0 skipped |
| Navigation tests | `node --import ./tests/ts-resolve.mjs --test tests/navigation.test.mjs` (clients/mobile) | **20 / 20 pass** |
| Mobile dependency audit | `npx audit-ci@7.1.0 --config audit-ci.jsonc` (clients/mobile) | pass |
| Server + web audit (CI threshold) | `npm audit --audit-level=high` (server, clients/web) | 0 vulnerabilities each |
| Android JS bundle | `npx expo export --platform android` (clients/mobile) | pass (8.9 MB Hermes bundle) |
| Server build | `npm run build` (server) | pass |
| Migrations | `npm run db:migrate` twice against empty PostgreSQL 18.4 | applied (438 tables), replay idempotent |
| Server suite, real DB | `npm test` (server), `LINQA_REQUIRE_DB_TESTS=1`, CI's env | **1,161 pass**, 0 fail; 78 skipped, 68 todo |
| The two previously blocked files | `historical-sender-key.integration`, `protected-media.integration` | **19 / 19 pass**, none skipped |
| Wallet / ledger / idempotency | `npm run linqasend:test:wallet:db` (server) | **78 / 78 pass** in 6 files; migration replay left ledger postings unchanged; disposable DB dropped |
| Chat security + encryption | `npm run test:security:chat`; `npm run test:encryption` (server) | 116 / 116 pass; 4 / 4 + 4 / 4 pass |
| API image build | `docker build server` | pass; runs non-root; `dist/index.js`, migrations and readiness script present |
| Image vulnerability scan | `trivy image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1` | **exit 0** (full scan, no fixable HIGH/CRITICAL) |

Server tests total against a real database: 1,161 + 78 = **1,239 passed, 0 failed.** The 78 are the wallet/ledger files that
skip unless `LINQA_WALLET_DISPOSABLE_TEST_DB=1`; no CI workflow ever set it, so none of them ever ran in CI. `ci.yml` now
runs the disposable-database runner after `npm test`.

Database used: a throwaway `postgres:18-alpine` container with CI's own test-only fixtures (no real secrets), on a
Docker-assigned loopback port. Several real dev databases run on this machine (including the one the phone uses); none was
touched. The container is removed at the end of the session.

## Physical-device validation (Samsung Galaxy A03s, SM-A037U, USB)

Metro served the working tree; API on 8088 via `adb reverse` (8080 on the phone). Screenshots are kept local (they show
account details) and are not committed.

| Item | Observation |
|---|---|
| Cold start | App reaches Home; all icons present from the first frame (tab bar, Quick Actions, header) after the font-load fix |
| Icon loading | Root cause seen on device: "Font file for ionicons is empty" (empty font response from Metro). Font now preloaded with retries before first paint |
| Calls | One header, correct top inset; "+" badge sits on the phone icon; avatars load |
| Chats list | Approved dark palette applied (`#121214` / `#22252B`) |
| Thread | Approved dark thread: `#121214` background, `#087F79` outgoing with white text, dark "Call ended" pill, dark in-thread cards |
| Protected photo | Dark card with teal outline, white title, `#B9C1CA` subtitle (previously faded to 3.1–3.9:1) |
| Modals | `Modal ... translucent navigation bar` warning: 0 occurrences (was one every ~4 s) |
| Wallpaper picker | Opens from chat settings and from the default screen (deep link); dimming, tile preview, "Use for this chat", "Follow my default", "Reset to Classic Dark Doodle" all work; dimming and chat-follow persisted across force-stop |
| Account switcher | Sheet opens; only one account exists on this phone, so an actual switch could **not** be tested |
| Crashes | 0 native `FATAL`, 0 JS errors in the final session |

## Contrast (WCAG AA, 4.5:1) for the approved palette

Primary text / background 18.7; primary / cards 15.4; secondary / background 10.3; secondary / cards 8.4 (timestamps);
white / outgoing `#087F79` **4.86 (lowest)**; accent / background 8.6; secure / cards, sealed / background, danger / cards all
above 7. Dividers (`#34383F`, 1.59:1) are decorative separators in your specification, not text. All text pairs are asserted in
`tests/chat-wallpapers.test.ts`.

## Remaining failures and open items

1. **G0–G4 Green Gates: red, by design.** They download signed device-farm / production evidence from URLs held in secrets
   that are not set. Exact missing secrets, required checks and the remediation checklist: `docs/RELEASE_GATE_REMEDIATION.md`.
2. **Signed API Image on `main`:** will stop at its readiness step until the signed readiness envelope variables exist
   (correct, fail-closed). Its image build, which was failing, is fixed and verified locally.
3. **CI on the latest commits is unverified.** The repository now returns 404 to anonymous requests (it appears to have been
   made private), so Actions results could not be read from here. Check the Actions tab for `af8270c` and `99f752b`.
4. **Intermittent `SECURE_CORE_AUTHENTICATION_FAILED`.** On one cold start (5:36 PM) every message in the thread failed to open;
   the same messages opened on the starts before and after it (4:30–5:24 PM, 5:41 PM). No related JS error or API rejection was
   found and I did not change secure-core code. Cause unknown; secure messaging is **not** considered validated until this is
   explained or ruled out.
5. **Unexplained saved state.** The phone's saved default wallpaper was Vintage Lavender although I only meant to set a
   per-chat override during an earlier demo. The button wiring was re-read and is correct, and saving/clearing persists
   correctly; I could not determine how the default got set. It was reset to Classic Dark Doodle.
6. **Not tested:** physical iOS; the LG phone; an actual account switch (single account); the two-pane tablet layout on a
   tablet; Detox/UI automation (not set up).
7. **Dev-build warnings:** "Require cycle" warnings in `features/call-rooms` (pre-existing, warnings only).
8. **Database certification pack** (pasted G0–G4 DB runner) is deliberately **not adopted**; reasons are in
   `docs/RELEASE_GATE_REMEDIATION.md`.

## Repository hygiene (Phase 5)

- Root `package.json` / `package-lock.json`: created 2026-10-24 15:20, never tracked, referenced by no workflow, script or
  Detox config (none exists); they listed Jest/Detox/Testing Library and match the pasted install instruction, not any part
  of this repo. **Removed.** Every `npm` step in CI runs under `server/` or `clients/*`. Root `node_modules/` is gitignored and
  was left alone.
- `.tmp/`: a stale local PostgreSQL 18.3 cluster and logs from 2026-10-18 (only built-in databases; dead pid; no listener; no
  references; the supported wallet runner does not use it). **Removed**, and `.tmp/` is now gitignored.
