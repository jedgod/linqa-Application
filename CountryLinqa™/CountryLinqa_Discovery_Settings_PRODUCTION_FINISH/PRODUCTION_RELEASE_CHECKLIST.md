# CountryLinqa Discovery — Production Release Checklist

## UX
- [ ] Page 1 clearly separates outbound and inbound reach.
- [ ] Page 2 has real country search, selection count and plan limit messaging.
- [ ] Page 3 shows all supported regions.
- [ ] Page 4 explains Worldwide without implying precise-location sharing.
- [ ] Page 5 prices come from billing configuration, not hard-coded UI.
- [ ] Page 6 verifies entitlement from server before showing success.
- [ ] Back navigation warns when there are unsaved changes.
- [ ] Loading, empty, offline, error and retry states exist.
- [ ] Screen-reader labels exist for switches, radio controls and country selection.
- [ ] Dynamic text sizing does not break buttons.
- [ ] Reduced-motion preference is respected.

## Security / Privacy
- [ ] Verified identity country cannot be modified by discovery settings.
- [ ] Free/Premium/Elite restrictions are server-authoritative.
- [ ] Country and region codes are allow-listed.
- [ ] Preference updates use optimistic concurrency/versioning.
- [ ] Sensitive country-identity changes require separate step-up verification.
- [ ] Exact GPS coordinates are never written into discovery policy.
- [ ] Audit events do not contain unnecessary PII.
- [ ] Suspicious rapid scope changes can feed the risk engine.
- [ ] Blocked users are excluded regardless of discovery mode.
- [ ] Account-switch cache isolation is tested.

## Backend
- [ ] GET preferences endpoint.
- [ ] PUT preferences endpoint.
- [ ] Catalog endpoint for supported countries/regions.
- [ ] Entitlement service integrated.
- [ ] Audit/outbox event emitted after committed updates.
- [ ] Rate limits applied.
- [ ] Idempotency/retry behavior verified.
- [ ] PostgreSQL migration reviewed against live schema.

## Discovery Engine
- [ ] Outbound policy is applied to people search.
- [ ] Inbound policy is applied before candidate exposure.
- [ ] Pause Discovery removes user from new discovery.
- [ ] Existing contacts remain available when configured.
- [ ] Verified-only filtering is enforced server-side.
- [ ] Businesses/events/communities honor their recommendation toggles.
- [ ] Privacy visibility is applied after candidate eligibility.

## Certification
- [ ] Unit tests.
- [ ] API contract tests.
- [ ] E2E: Free user.
- [ ] E2E: Premium user.
- [ ] E2E: Elite Worldwide.
- [ ] E2E: offline save/retry.
- [ ] E2E: account switch.
- [ ] Physical Android test.
- [ ] Physical iPhone test.
- [ ] Screenshots bound to release Git SHA.
