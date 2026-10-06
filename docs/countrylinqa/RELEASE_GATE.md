# CountryLinqa release gate

A release is not certified because it compiles or the tests pass.

## Automated (run on every build)
- [ ] `npm test` in `server/`, including `countrylinqa-engine.test.ts` and `countrylinqa-engine.integration.test.ts` (needs `DATABASE_URL`; CI sets `LINQA_REQUIRE_DB_TESTS=1` so a missing database fails the build).
- [ ] `npm run typecheck` in `clients/mobile/` and `tests/mobile-app.test.ts`.
- [ ] `node scripts/countrylinqa-certification.mjs inventory` passes.
- [ ] Migration 044 applies and replays cleanly.

## Privacy invariants (covered by the integration test)
- [ ] SQL eligibility equals the reference model for every viewer mode x candidate inbound mode x country x contact state.
- [ ] Blocks, paused accounts, undiscoverable accounts, unverified and restricted accounts never appear.
- [ ] A cached pool cannot outlive a block or a policy change.
- [ ] A cursor is rejected after a policy change, a filter change, tampering or 15 minutes.
- [ ] Filters only narrow results. A client cannot inject a country scope.
- [ ] Saved-search alerts carry a count only, never names, and the first run only records a baseline.
- [ ] Analytics and impressions hold no raw search text or coordinates.

## Manual / environment
- [ ] k6 thresholds pass at target load in staging.
- [ ] Alert rules are loaded and firing is tested.
- [ ] Kill switches tested (`ROLLOUT_RUNBOOK.md`), including a rollback drill.
- [ ] Physical two-country certification PASS on the exact build (`TWO_COUNTRY_PHYSICAL_CERTIFICATION.md`).
- [ ] `node scripts/countrylinqa-certification.mjs manifest` run on a clean tree, then `verify <manifest> <evidence>` passes.
- [ ] iPhone physical test PASS when an iOS release is required (there is no `ios/` project yet, so this stays PENDING).
