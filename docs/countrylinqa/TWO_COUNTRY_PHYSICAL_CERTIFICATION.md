# CountryLinqa™ Two-Country Physical Certification

This is an execution template. Do not mark PASS until tests are performed.

## Required evidence
- Release Git SHA
- Server artifact digest
- Mobile build number / binary digest
- Database migration level
- Device A model / OS
- Device B model / OS
- Test account IDs (internal evidence only)
- Verified country for A
- Verified country for B
- UTC timestamps
- Screen recordings/screenshots
- Relevant server logs / request IDs

## Scenario A — My Country
Device A: verified country A
Device B: verified country B
1. Set A outbound = MY_COUNTRY.
2. Confirm B is not exposed to A if B is in another country.
3. Confirm eligible same-country control account appears.
4. Confirm no client-side override can expose B.

## Scenario B — Selected Countries
1. Add country B to A's selected countries.
2. Confirm B appears only if B's inbound policy permits country A.
3. Remove country B.
4. Confirm B disappears after cache invalidation.

## Scenario C — Candidate inbound restriction
1. B inbound = MY_COUNTRY.
2. A remains outside B's country.
3. Even if A outbound includes B, B must not appear.
4. Change B inbound to include A's country.
5. Confirm eligibility becomes true.

## Scenario D — Region
1. A selects a supported region containing B.
2. Confirm B appears if mutually eligible.
3. Confirm country outside selected region does not appear.

## Scenario E — Worldwide
1. Use an Elite entitlement.
2. Set A outbound = GLOBAL.
3. Confirm global scope does not bypass B's inbound restrictions.

## Scenario F — Safety overrides
- Block B from A and verify immediate disappearance.
- Pause B discovery and verify B disappears for strangers.
- Set B to CONTACTS_ONLY and verify only existing contacts retain eligibility.

## Scenario G — Filters
- Language
- Interest
- Profession
- Verified only
- Online now
Verify each filter narrows an already eligible set and never broadens geographic eligibility.

## Scenario H — Saved search
1. Save filter set.
2. Restart application.
3. Re-run saved search.
4. Confirm server re-evaluates current policy rather than replaying stale results.

## Scenario I — Pagination/cache
1. Load page 1 and page 2.
2. Ensure no duplicates.
3. Change policy.
4. Confirm old cursor/cache cannot leak out-of-scope candidates.

## PASS requirements
Every scenario must pass on both physical devices and evidence must be bound to the exact deployed Git SHA.
