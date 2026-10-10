# CountryLinqa v1→v3 Repo-Native Execution Runbook

## Phase A — freeze and inventory
1. Create a checkpoint commit before integration.
2. Run `node scripts/countrylinqa-repo-inventory.mjs`.
3. Record the exact current migration list.
4. DO NOT assume migration 041/042/043 from generic packs are free.
5. Map every v1→v3 concept to the existing CountryLinqa files/tables first.

## Phase B — close known contract mismatches
1. Make `body` canonical for feed content.
2. Map DB `display_name` -> DTO `displayName`.
3. Map DB `verified_country_code` -> DTO `countryCode`.
4. Centralize mappings in repo-native-adapter.ts.
5. Remove screen-level guessing/fallback chains after all clients migrate.

## Phase C — integrate discovery settings
Adapt outbound/inbound reach, privacy visibility, pause discovery and entitlements
into the schema created by 027_countrylinqa_discovery_controls.sql where possible.
Only create a NEW migration for columns/indexes actually absent in the live schema.

## Phase D — integrate discovery engine
Patch the EXISTING:
- discovery.ts
- feed-scope.ts
- service.ts
- golive/businessRanking.ts
- golive/eventRanking.ts
Do not create duplicate engines under a second route tree.

Mutual people eligibility:
viewer outbound policy
AND candidate inbound policy
AND block/safety/moderation
AND verified-only
THEN ranking.

## Phase E — advanced discovery
Integrate:
- language/interests/profession filters
- saved searches
- signed cursor pagination
- Redis versioned cache
- ranking reason codes
- diversity controls
- abuse limits
- privacy-safe telemetry

## Phase F — production scale
Replace broad in-memory/oversampled filtering with indexed SQL candidate retrieval.
Use keyset cursors. Keep policy checks server-authoritative.
Recommendation workers must call the same eligibility policy implementation.

## Phase G — migration execution
Use the repository's actual migration runner.
Apply only newly required migration(s) in order.
Verify up/down/restart behavior in a disposable/staging database before production.

## Phase H — build/test
Use package.json scripts discovered from the live repo rather than guessed commands.
Minimum gates:
- server TypeScript build/typecheck
- server unit/integration tests
- CountryLinqa parity/contract tests
- mobile typecheck
- web typecheck if CountryLinqa web integration is enabled
- unified onboarding release gate
- CountryLinqa static gate
- database behavior tests

## Phase I — Android
Build the actual Android artifact from clients/mobile.
Install on the Samsung SM-A037U (or release target device).
Test onboarding, settings, My Country, selected countries, region, worldwide,
inbound restriction, pause, block, filters, saved search, pagination and cache invalidation.
Capture evidence and artifact SHA-256.

## Phase J — iPhone
Build/sign the actual iOS artifact in the supported Apple build environment.
Run the same matrix on a physical iPhone.
Do not mark iOS PASS from simulator/mock-shell evidence.

## Phase K — exact-SHA certification
1. Clean worktree.
2. Create server/mobile release artifacts.
3. Generate `countrylinqa-certification-manifest.json`.
4. Bind screenshots/logs/test reports to Git SHA and artifact digests.
5. Fill evidence.json only from executed tests.
6. Run final gate.
7. Release only when the required physical-device matrix is PASS.
