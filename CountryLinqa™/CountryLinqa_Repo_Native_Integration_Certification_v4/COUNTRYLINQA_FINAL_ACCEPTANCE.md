# Final acceptance

CountryLinqa is repo-native complete only when:

- Existing routes/services are the single source of truth.
- No generic v1/v2/v3 duplicate route stack remains.
- Database migration numbering matches the live repository.
- `body`, `displayName`, and `countryCode` contracts are consistent.
- Onboarding country detection/discovery/completion is wired.
- Discovery Settings controls outbound/inbound reach separately.
- People discovery enforces mutual privacy before ranking.
- Events/businesses/communities/feed use the effective country scope.
- Advanced filters and saved searches re-evaluate current policy.
- Redis cache and cursors cannot bypass changed policy.
- Moderation/block/pause override discovery.
- Typechecks/tests/builds pass.
- Android physical test passes on the actual artifact.
- iPhone physical test passes when iOS release is required.
- Evidence is bound to the exact clean Git SHA and artifact SHA-256.
