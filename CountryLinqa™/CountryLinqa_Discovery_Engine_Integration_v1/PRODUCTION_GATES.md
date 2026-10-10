# Production gates

## Correctness
- [ ] My Country returns only eligible same-country candidates.
- [ ] Selected Countries returns only selected-country candidates.
- [ ] Region resolves against canonical region catalog.
- [ ] Worldwide still respects candidate inbound privacy.
- [ ] Contacts Only cannot leak strangers.
- [ ] Pause Discovery removes a user from new-person discovery.
- [ ] Existing contacts behavior matches product policy.
- [ ] Block overrides every CountryLinqa mode.
- [ ] Verified-only is enforced server-side.

## Surfaces
- [ ] People
- [ ] Posts/feed
- [ ] Events
- [ ] Businesses
- [ ] Communities
- [ ] Unified search
- [ ] Recommendations

## Security
- [ ] Client cannot inject arbitrary country scope.
- [ ] Client cannot bypass Premium/Elite limits.
- [ ] Verified country comes from server identity state.
- [ ] Pagination cannot expose out-of-scope candidates.
- [ ] Cache key contains policy version.
- [ ] Cache invalidates on policy change.
- [ ] Audit events record policy changes, not search contents.
- [ ] Rate limiting applied to search/discovery endpoints.

## Performance
- [ ] Country-code indexes exist on all discovery surfaces.
- [ ] Candidate filtering is moved into SQL for high-volume production.
- [ ] No N+1 policy lookups.
- [ ] Cursor pagination replaces OFFSET.
- [ ] Load test P95/P99 measured.
- [ ] Recommendation eligibility occurs before expensive ranking.

## Certification
- [ ] US -> US only test.
- [ ] US -> US/GH selected countries test.
- [ ] US -> West Africa region test.
- [ ] Elite Worldwide test.
- [ ] Candidate inbound restriction test.
- [ ] Contacts Only test.
- [ ] Pause Discovery test.
- [ ] Block test.
- [ ] Account-switch isolation test.
- [ ] Physical Android test.
- [ ] Physical iPhone test.
- [ ] Evidence bound to exact Git SHA.
