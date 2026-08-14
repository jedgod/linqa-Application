# Execution and Launch Acceptance Tests

## Promotion controls

- Feature cannot be approved while required gates are PENDING or FAIL.
- Requester cannot approve their own promotion where separation of duties applies.
- Rollback disables the feature immediately.
- Rollout bucket remains deterministic.
- GENERAL_AVAILABILITY requires 100 percent rollout and explicit approval.

## Communities and business

- Community owner membership is created atomically.
- Suspended communities reject new events.
- Business verification cannot be self-approved.
- Public profile responses expose only permitted data.

## AI worker

- Worker leases jobs with SKIP LOCKED.
- Two workers cannot process the same job concurrently.
- Missing confidential AI provider fails closed.
- Plaintext is never stored in AI job records.
- Expired jobs are not processed.

## Enterprise

- SCIM operations require organization-scoped authorization.
- Deactivated SCIM users lose enterprise access.
- Legal holds require compliance-admin authorization.
- Legal-hold release is audited.
- Organization events never cross tenant boundaries.
