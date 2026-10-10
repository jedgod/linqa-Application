# CountryLinqa Production Rollout

## Phase 0 — disabled
Deploy schema/code with discovery kill switch available. No new traffic.

## Phase 1 — internal
Enable staff/internal accounts only. Validate dashboards, traces, Redis and workers.

## Phase 2 — 1%
Enable deterministic 1% cohort. Hold at least one observation window.
Rollback if error/latency/privacy gates breach.

## Phase 3 — 5%
Enable 5%. Validate cache hit rate, moderation, recommendation quality,
saved-search worker success and abuse telemetry.

## Phase 4 — 25%
Increase only after SLOs remain green and no privacy/security regressions exist.

## Phase 5 — 50%
Run peak load and worker backlog checks.

## Phase 6 — 100%
Only after exact-SHA physical two-country certification is PASS.

## Emergency rollback
1. globalDiscoveryOff=true
2. recommendationWorkersOff=true
3. alertsOff=true
4. worldwideOff=true if issue is global-scope specific
5. Preserve audit/telemetry.
6. Do not delete evidence.
7. Diagnose before re-enabling.

Never use a mobile client flag as the sole kill switch. Server enforcement is authoritative.
