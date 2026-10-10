# Final CountryLinqa release gate

A release is NOT production-certified merely because code compiles.

Required:
- [ ] Migration 043 applied successfully.
- [ ] Candidate queries use indexes/keyset pagination.
- [ ] Redis health/failover tested.
- [ ] Cache cannot bypass privacy policy.
- [ ] Recommendation worker uses same eligibility service as synchronous requests.
- [ ] Saved-search alerts re-evaluate current policy.
- [ ] Moderation exclusion works before ranking.
- [ ] Feature flags are server-authoritative.
- [ ] Kill switches tested.
- [ ] SLO dashboards/alerts active.
- [ ] k6 thresholds pass at target load.
- [ ] No raw search text/precise location in analytics.
- [ ] 1%/5%/25%/50% rollout gates documented.
- [ ] Physical two-country certification PASS.
- [ ] Git worktree clean during manifest generation.
- [ ] Git SHA matches deployed server/mobile evidence.
- [ ] Server/mobile SHA-256 artifact digests match evidence.
- [ ] Rollback drill completed.

Only then approve 100% CountryLinqa discovery rollout.
