# CountryLinqa discovery rollout

Server flags are authoritative. A mobile flag is never the only kill switch.
Flags live in `countrylinqa_feature_flags` and are cached for 60 seconds, so a change takes effect within a minute with no deploy.

| Flag | Controls |
|---|---|
| `countrylinqa.enabled` | Everything below. Turn off for a full stop. |
| `countrylinqa.people` | People search, unified search |
| `countrylinqa.recommendations` | Suggested people and the snapshot worker |
| `countrylinqa.saved_search_alerts` | Alert opt-in and the alert worker |
| `countrylinqa.advanced_ranking` | Reserved for ranking experiments |
| `countrylinqa.global_discovery` | Existing Worldwide switch |

A missing flag row counts as OFF.

## Percentage rollout

Set `config.rolloutPercent` on a flag (default 100). A user is in the cohort when a stable hash of their id falls below the percent, so the same users stay in as you raise it.

```sql
UPDATE countrylinqa_feature_flags SET enabled = TRUE, config = '{"rolloutPercent": 1}' WHERE key = 'countrylinqa.people';
```

## Phases

0. **Disabled.** Deploy schema and code with `countrylinqa.people` off.
1. **Internal.** Enable for staff only (percent 0 plus staff test accounts, or a staging environment).
2. **1%.** Hold at least one observation window.
3. **5%.** Check cache hit rate, saved-search worker success and abuse telemetry.
4. **25%, 50%.** Increase only while SLOs stay green and there are no privacy regressions. Run peak load at 50%.
5. **100%.** Only after the exact-SHA physical two-country certification is PASS (see `TWO_COUNTRY_PHYSICAL_CERTIFICATION.md`).

Roll back at any phase if error rate, latency or any privacy gate breaches.

## Emergency rollback

1. `UPDATE countrylinqa_feature_flags SET enabled = FALSE WHERE key = 'countrylinqa.people';`
2. Same for `countrylinqa.recommendations` and `countrylinqa.saved_search_alerts` as needed.
3. For a full stop, set `countrylinqa.enabled` to FALSE.
4. If the problem is Worldwide-specific, set `countrylinqa.global_discovery` to FALSE.
5. Keep audit rows and telemetry. Do not delete evidence.
6. Diagnose before re-enabling.

## SLOs

Availability 99.9%, people search P95 under 350 ms and P99 under 800 ms, error rate under 1%, cache hit rate at least 70%, saved-search job success at least 99.5%. Alert rules: `ops/observability/countrylinqa-alert-rules.yml`. Load test: `tests/load/k6-countrylinqa-discovery.js`.

## Workers

`npm run countrylinqa:workers` (add `-- --once` for a single pass) refreshes recommendation snapshots and runs saved-search alerts. It uses the same eligibility service as live requests and re-checks policy on every run.
