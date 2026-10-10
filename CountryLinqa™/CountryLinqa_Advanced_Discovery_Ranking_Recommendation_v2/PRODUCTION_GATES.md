# Advanced Discovery Production Gates

## Ranking
- [ ] Geographic eligibility happens before ranking.
- [ ] Block/safety rules happen before ranking.
- [ ] Ranking cannot resurrect ineligible candidates.
- [ ] Recommendation reason codes are explainable.
- [ ] Diversity limits prevent one profession/category dominating.
- [ ] No protected/sensitive attribute is used as a hidden ranking proxy.

## Filters
- [ ] Country scope is intersected with policy, never replaces policy.
- [ ] Language filter validated.
- [ ] Interest filter validated.
- [ ] Profession filter validated.
- [ ] Verified-only server enforced.
- [ ] Online state uses bounded recent-activity logic.

## Saved searches
- [ ] User ownership enforced.
- [ ] Search limits enforced.
- [ ] Stored filters revalidated when executed.
- [ ] Saved search does not persist stale result IDs.
- [ ] Alert delivery respects current privacy and entitlement state.

## Redis / pagination
- [ ] Cache key includes user, policy version, surface and filter digest.
- [ ] Short TTL.
- [ ] Policy change invalidates by version.
- [ ] Opaque signed cursor.
- [ ] Cursor expiration.
- [ ] No duplicates across pages.
- [ ] No out-of-scope result after policy change.

## Abuse resistance
- [ ] Search rate limit.
- [ ] Pagination rate limit.
- [ ] Profile-open enumeration limit.
- [ ] Saved-search creation limit.
- [ ] Device/account signals feed existing risk engine.
- [ ] Scraping patterns generate security telemetry.
- [ ] Do not reveal whether a hidden/private account exists.

## Telemetry
- [ ] No raw phone.
- [ ] No precise coordinates.
- [ ] No raw search query in analytics.
- [ ] Record latency/result count/mode/surface.
- [ ] Audit security events separately from product analytics.

## Certification
- [ ] Two physical devices.
- [ ] Two verified countries.
- [ ] My Country.
- [ ] Selected Countries.
- [ ] Region.
- [ ] Worldwide.
- [ ] Inbound restrictions.
- [ ] Block / pause / contacts-only.
- [ ] Filters.
- [ ] Saved searches.
- [ ] Cache invalidation.
- [ ] Pagination.
- [ ] Evidence bound to exact SHA.
