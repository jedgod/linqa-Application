# Stabilization and release-gate evidence — 2026-10-24

Code verified at commits `af8270c` (dark theme), `99f752b` (CI + docs) and `668e559` (secure-core fix), on branch `agent/production-module-hardening`
(`main` is at `135fc20`; it has not been advanced to these commits). This record is the only change made after them (later commits are listed in the git log).

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
4. **Intermittent `SECURE_CORE_AUTHENTICATION_FAILED`: mechanism found and fixed (commit `668e559`); field soak still short.**
   Cause: overlapping opens of the same message. The core refuses a second open of an envelope (replay protection) and
   `decrypt_message` reports every core error as the opaque `AuthenticationFailed`, so a duplicate open looks like a crypto
   failure. On cold start the thread's receiver is rebuilt when the outbox database finishes opening, which re-opens the thread
   while the first pass may still be running. `SecureCoreMessaging.open()` now shares one in-flight open per message. Details,
   guarantees and what was deliberately not added: `docs/SECURE_CORE_RECOVERY.md`. The one real incident (5:36 PM) had no logs,
   so it is attributed to this mechanism by inference; the mechanism itself is reproduced in tests that failed before the fix.
   See "Cold-start repetition" below for what the device run does and does not show.
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

## Secure Core fix (commit `668e559`)

| Check | Result |
|---|---|
| Reproduction tests, run **before** the fix | 3 failed with the core's `replay` error (concurrent opens; whole thread opened twice at once; different content for one id) |
| `tests/secure-core.test.ts` after the fix | **22 / 22 pass** (adds real-failure guard, context mismatch, account-scope change mid-open, cross-account isolation) |
| CI's secure-core step (`messaging-gate-security` + `secure-core`) | 25 / 25 pass |
| Regression tests (CI list, 20 files) | **221 / 221 pass** (was 215) |
| Mobile typecheck | pass |

Also in that commit: `scripts/run-wallet-db-tests.mjs` now fails when vitest reports any wallet suite as skipped, todo or
failed. A zero exit does not prove the suites ran, which is how 78 tests skipped silently. Re-verified against a disposable
PostgreSQL 18: 6 files, 78 / 78 pass, exit 0.

## Cold-start repetition (post-fix, Galaxy A03s)

Method: `scripts/` is not used; a Node script drove adb, finding every button from the UI tree (no fixed coordinates), and
classified each launch: force-stop, launch, wait 75 s, open Chats, open the Greene conversation, wait 60 s, read the screen.

| Run | Thread opened | Messages readable | "Can't open" | `SECURE_CORE_AUTHENTICATION_FAILED` | Still sealed |
|---|---|---|---|---|---|
| 1 | yes | 7 | 0 | 0 | 0 |
| 2 | yes | 7 | 0 | 0 | 0 |
| 3 | yes | 7 | 0 | 0 | 0 |
| 4 | yes | 7 | 0 | 0 | 0 |
| 5 | yes | 7 | 0 | 0 | 0 |
| 6 | not counted: the conversation row was not found on screen | | | | |

**Read this honestly:** 5 clean launches. Before the fix the failure appeared on about 1 launch in 7, so 5 clean launches would
happen about 46% of the time even if nothing had changed. This run is consistent with the fix but does **not** prove it. The
proof is the reproduction tests, which fail without the fix and pass with it. More cold starts (and a second device) would
strengthen the field evidence.

## Environment incident during this run (not an app defect)

The development API on port 8088 stopped (its `node --watch` process restarted 11 times, then exited: "Failed running
'src/index.ts'"; the same flapping seen earlier today, likely from file-change events in the OneDrive-synced folder). With the
API down, the app showed "Linqa could not connect. Check your connection" and **kept the stored session**, which is the intended
offline behaviour (`session-refresh.ts` only discards a session on an explicit 401). My first automation then tapped "Back to
welcome" by fixed coordinates, which looked like a sign-out; no session, account or device key was lost. The API was restarted
without `--watch` for this session. Recommendation: run the dev API without `--watch` on this machine, or move the repo out of
OneDrive.

## Status against the "mandatory release validation" list

| Item | Status |
|---|---|
| Secure Core cold starts, no unexplained failures | mechanism fixed and tested; 5/5 counted device launches clean; soak short |
| Account switching, no cross-account leakage | covered by unit tests (scope change mid-open, cross-account isolation); **not tested on a device with two accounts** |
| Offline message recovery | not re-tested beyond cold-start readability; the app keeps its session offline (see above) |
| Database integration, zero skips | 1,239 / 1,239 server tests pass against PostgreSQL 18.4; wallet runner now rejects skips; CI runs it |
| Wallet / ledger tests execute in CI | wired into `ci.yml`; **CI result not observable from here** (repo private) |
| Android physical device | repeated cold starts done (one device) |
| iOS physical device | **not done** |
| G0–G4 genuine signed evidence | **not available**; see `docs/RELEASE_GATE_REMEDIATION.md` |
| Signed API Image production verifier | requires the readiness envelope; not available |
| Release owner approval of the exact SHA | **not obtained** |

## Not adopted from the pasted "v4.0" plan, and why

- `SecureCoreStartupGate`, its engine interface and tests: the repo already has single-flight init (`SecureCoreDevice.ensure`),
  a locked/not-ready refusal, account-scope generation checks and post-decrypt scope checks; a second gate would add a place for
  state to disagree. The real defect was elsewhere (see above), and the proposed gate would not have caught it.
- `verify-database-certification.mjs`: it consumes a hand-shaped JSON report; the repo's runner now enforces "no skips" directly
  from the test run, which is the property that mattered.
- `verify-release-evidence.mjs` and `linqa-release-certification.yml`: they wrap an executable named in an environment variable
  and call a runner script that does not exist here; the repository's own signed-evidence verifier and workflows already do this
  work with signature, revision and environment binding.
