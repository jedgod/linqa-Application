# Linqa Milestone Execution and Launch Pack — Apply Guide

1. Apply migration `008_execution_launch.sql`.

2. Register:
   `ReleasePromotionService`
   `CommunityService`
   `BusinessProfileService`
   `ScimService`
   `LegalHoldService`
   `AiWorkerService`

3. Register execution-launch routes.

4. Add new scopes:
   `release:promote`
   `release:approve`
   `release:rollback`
   `communities:write`
   `business:write`
   `scim:write`
   `legal-hold:write`

5. Seed release-gate results before requesting promotion.

6. Keep the confidential AI provider fail-closed until a reviewed provider exists.

7. Implement organization-scoped authorization before enabling SCIM.

8. Mount `MilestoneLaunchDashboard` only in the administrative application.

9. Run execution-launch CI and acceptance tests.

10. Promote features progressively:
    `INTERNAL` -> `ALPHA` -> `BETA` -> `CANARY` -> `GENERAL_AVAILABILITY`.

Status in this repo: steps 1-3 and 6 are applied. Step 4 needs no separate
registration - scopes in this codebase are plain strings checked by
`requireScope()`, not a central enum, so the execution-launch routes already
enforce all seven scopes listed above; issuing a token with one of those
scopes is the only remaining step, and nothing in this pack issues them
(see `docs/production-checklist.md`). Step 5 is **not yet satisfied**:
`milestone_promotions.feature_key` has a foreign key into
`milestone_feature_flags(key)`, but nothing in either milestone pack ever
inserts a `milestone_feature_flags` row - `POST /v1/admin/promotions` will
always fail with a foreign-key violation until an operator seeds at least one
feature-flag row directly. Step 7 is **not implemented**: none of
`ScimService`, the SCIM route, or `AuthPrincipal` carry an organization-scope
check, so any caller holding `scim:write` can upsert directory users into any
organization ID they pass in the URL - do not enable SCIM in production until
this is added. Step 8 is a deployment/build concern (which app bundle mounts
`MilestoneLaunchDashboard`), not addressed by this pack's code. Step 9 is
covered by `tests/security/execution-launch-acceptance.md`, but as with the
other `tests/security/*.md` files in this repo, it is an acceptance
checklist, not automated tests - none of it runs in CI.
