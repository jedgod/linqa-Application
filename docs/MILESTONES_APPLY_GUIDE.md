# Linqa Three Production Milestones — Apply Guide

1. Apply migration `007_three_milestones.sql`.
2. Register `MilestoneService`, `CollaborationService`, `AiJobService`,
   and `EnterprisePolicyService`.
3. Register milestone-platform routes.
4. Mount `MilestoneFeatureGate` around 2.0 and 3.0 features.
5. Keep all 2.0 and 3.0 feature flags disabled by default.
6. Complete Linqa 1.0 security and interoperability testing first.
7. Roll out Linqa 2.0 collaboration and AI gradually.
8. Deploy Linqa 3.0 only after enterprise legal and security review.
9. Run `milestone-release.yml` for every candidate.
10. Never gate baseline encryption or account security behind payment.

Status in this repo: steps 1-3 are applied (`server/src/db/migrations/007_three_milestones.sql`,
services registered in `server/src/bootstrap/service-container.ts`, routes in
`server/src/routes/milestone-platform.ts` registered from
`server/src/bootstrap/register-all.ts`). Step 4 (`MilestoneFeatureGate`) ships
as a component (`clients/web/src/milestones/MilestoneFeatureGate.tsx`) but is
not yet mounted around any specific 2.0/3.0 feature in the live UI - there are
no 2.0/3.0 features in the live UI yet to gate. Step 5 holds by construction:
`007_three_milestones.sql` defines `milestone_feature_flags.enabled` as
`NOT NULL DEFAULT FALSE` (no flag rows are seeded by this migration; every
future flag starts disabled unless a row explicitly sets otherwise), and
`MilestoneService.enabled()` also independently requires the flag's milestone
to be `ACTIVE` in `product_milestones` - Linqa 2.0/3.0 are seeded as
`PLANNED`, not `ACTIVE`, so even an `enabled = TRUE` flag under 2.0/3.0 would
still resolve to `false` today. Steps 6-10 are process/governance steps, not
code.
