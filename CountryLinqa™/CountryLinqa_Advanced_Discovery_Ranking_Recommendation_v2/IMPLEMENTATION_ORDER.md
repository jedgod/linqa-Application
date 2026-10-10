# Recommended implementation order

1. Migration 042.
2. Canonical language / interest / profession catalogs.
3. Filter validator.
4. Server-side mutual eligibility reuse.
5. Candidate SQL pre-filtering.
6. Ranking + explanation reasons.
7. Diversity layer.
8. Opaque signed cursor.
9. Redis cache.
10. Saved-search repository/routes.
11. Abuse guard.
12. Privacy-preserving telemetry.
13. Mobile Advanced Search UI.
14. Mobile Saved Searches UI.
15. Recommendation surfaces.
16. Load/performance testing.
17. Two-country physical certification.
18. Bind evidence to exact Git SHA and release artifact digest.

Before GA, replace the sample LIMIT-500 candidate pool with indexed SQL/search-index retrieval appropriate to the live Linqa scale.
