# Integration order

1. Apply the Discovery Settings Production Finish pack first.
2. Confirm country_discovery_policy_v2 matches the live schema.
3. Add CountryLinqaPolicyResolver.
4. Connect People discovery first.
5. Enforce BOTH viewer outbound and candidate inbound policy.
6. Apply block/safety rules before exposure.
7. Connect posts/feed.
8. Connect events.
9. Connect businesses.
10. Connect communities.
11. Connect unified search.
12. Add recommendation ranking only after eligibility filtering.
13. Add Redis cache keyed by user + policy version + surface + cursor.
14. Invalidate cache when discovery policy changes.
15. Add telemetry using country/region scope only; avoid precise coordinates.
16. Run two-account and two-country physical-device certification.
