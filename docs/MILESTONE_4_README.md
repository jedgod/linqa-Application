# Linqa Milestone 4 — General Availability Hardening
Date: 2026-08-07

Milestone 4 is the final hardening layer before General Availability.

It assumes Milestones 1–3 have passed their functional, security, multi-user,
multi-device, federation, scale, and canary acceptance gates.

## Scope

1. Independent cryptographic audit evidence and release blockers
2. Penetration-test findings intake and remediation workflow
3. SOC 2 evidence collection and control mapping
4. GDPR / CCPA operational rights workflows
5. Regional data residency and tenant-region enforcement
6. Database partitioning, retention, archival, and deletion
7. Incident response orchestration and severity/SLA handling
8. Production observability, SLOs, error budgets, and alerts
9. Customer support operations and escalation workflows
10. Privacy-safe diagnostic bundles
11. Public app-store release gates
12. Staged General Availability rollout
13. Kill switches and emergency rollback
14. Production launch attestation

## GA principle

A feature can be functionally complete and still be blocked from GA.

GA requires:
- technical acceptance;
- security acceptance;
- privacy/legal acceptance;
- operational readiness;
- support readiness;
- release evidence;
- rollback capability.

No single service or UI state can self-declare production readiness.

## Status in this repository (2026-08-07 apply pass)

`ga_release_gates` seeds 12 gates in PENDING state and
`production_kill_switches_v2` seeds 8 switches disabled — this pack does
not fabricate GA readiness. `GaReleaseGateService.summary().ready` is
`false` until every required gate is explicitly approved by evidence
(`GaReleaseGateService.approve()`, which enforces a different approver
than requester) and zero CRITICAL findings remain open in
`security_findings_v2`.
