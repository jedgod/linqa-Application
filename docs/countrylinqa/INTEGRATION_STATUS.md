# CountryLinqa packs: how they were integrated

The five packs (Discovery Settings Production Finish, Engine Integration v1, Advanced Ranking v2, Scale Closure v3, Repo-Native Certification v4) were written against a generic schema. The repo already had a more complete policy-scoped implementation, so they were adapted rather than copied, as pack v4 itself directs.

| Pack | What it asked for | What the repo does |
|---|---|---|
| Production Finish | Separate outbound/inbound policy, pause, entitlement limits, optimistic save, audit | Already in `country_discovery_preferences` (migration 027) and `CountryLinqaService`. Added: `version` column, `expectedVersion` conflict check (409), and an audit row per save. **Not created:** `country_discovery_policy_v2`, which would be a second source of truth. |
| Engine v1 | Policy resolver and mutual eligibility on every surface | Enforced in SQL by `feed-scope.ts` for people, posts, events, businesses and communities. Added: pure reference model (`engine/eligibility.ts`) that the SQL is tested against, and unified search (`GET /v1/countrylinqa/search`) that delegates to each surface. |
| Ranking v2 | Filters, ranking with reasons, cursors, saved searches, abuse limits | `engine/people.ts`, `ranker.ts`, `filters.ts`, `cursor.ts`; rate limits on every route; discovery profile (`/discovery/features`). The pack's "online now" filter is **rejected** because presence is not exposed to strangers. |
| Scale v3 | Cache, kill switches, rollout %, workers, SLOs, k6 | Ranked-pool cache keyed by policy + feature version with live re-validation per page; DB-backed kill switches and rollout %; `npm run countrylinqa:workers`; alert rules, k6 script, runbook. The pack's separate moderation gate is covered by the existing safety predicate (blocks, suspended and restricted users). |
| Repo-native v4 | Inventory, contract DTOs, certification manifest | `scripts/countrylinqa-certification.mjs` (inventory, manifest, verify), `clients/mobile/services/countrylinqa.contract.ts`. |

Migration `044_countrylinqa_discovery_engine.sql` uses the next live number (the packs assumed 041-043, which are taken).

## Gap closure v4.1

- **Shared cache:** `engine/redis-cache.ts` is a Redis-backed cache used when `REDIS_URL` is set (in-process otherwise), built on the repo's own RESP codec so no dependency was added. Any Redis problem is a miss. Keys carry the policy and feature version, and every page is re-checked against live blocks, restrictions and policy in one query, so Redis never decides who is visible. Kill-switch flags use the same cache.
- **Candidate pool:** `COUNTRYLINQA_CANDIDATE_POOL_LIMIT` (default 300, clamped to 50-1000).
- **DB test gate:** `scripts/countrylinqa-db-test-gate.mjs` runs the PostgreSQL suites and fails if any test was skipped. Use a dedicated test database, not a shared dev one (the chat suite writes rows).
- **Workflow:** `.github/workflows/countrylinqa-certification.yml` (PostgreSQL 18 + Redis, no skips).
- **Isolated commits:** `scripts/commit-countrylinqa-only.ps1`.
- **Not taken from the pack:** its per-row `recheckCachedCandidates` callbacks (one query per row; the engine re-checks the whole page in one query) and its second certification manifest and physical-gate scripts, which `scripts/countrylinqa-certification.mjs` already covers.

## Certification execution v4.2

- `scripts/assert-dedicated-test-db.mjs`: refuses any database that is not clearly a throwaway one (name needs a `test` or `ci` word; `linqa`, `postgres` and `prod*` are refused). The DB test gate runs it first. The pack's version had a regex typo that would have failed to parse; this one is tested.
- `scripts/countrylinqa-cert-run.mjs` (software gate) and `countrylinqa-cert-preflight.mjs` (clean tree, then the gate, build, tests and mobile checks).
- `scripts/countrylinqa-release-report.mjs`: writes `certification/countrylinqa/release-readiness.json`. Software results come from CI step outcomes. **Physical Android is PASS only if the evidence file verifies against the build manifest for this exact commit** (the pack took it from an environment variable, which anyone could set). The report is scoped Android-only and shows iOS as blocked.
- The authoritative verifier stays `scripts/countrylinqa-certification.mjs`. It gained `--software-only` and now also requires `restrictedUser`, `redisUnavailable` and `accountSwitch` evidence and two different countries, matching the Android run sheet.
- One workflow, not two: the pack's separate release-gate workflow was folded into `countrylinqa-certification.yml` (now also runs on push to main and uploads the report).
- Run sheet and blockers: `certification/countrylinqa/ANDROID_TWO_COUNTRY_RUN.md`, `IOS_BLOCKER.md`; procedures: `RELEASE_EXECUTION_ORDER.md`, `FAILURE_RESPONSE.md`.

## Known limits
- Ranking runs over at most `COUNTRYLINQA_CANDIDATE_POOL_LIMIT` candidates per request, ordered by id. At large scale, move more scoring into SQL or a search index.
- Percentage rollout is deterministic per user but has no per-country cohorts.
- Physical-device certification and iOS are not done and cannot be done from CI.
