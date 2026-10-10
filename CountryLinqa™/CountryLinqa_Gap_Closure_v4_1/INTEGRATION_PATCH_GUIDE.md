# Integration patch guide

## 1. Keep rejected features rejected
Do not add `onlineOnly`, last-seen exposure, presence ranking, or stranger presence APIs.
Do not create another moderation service. Call the existing block and restricted-user checks.

## 2. Replace only the cache layer
Locate the current in-process CountryLinqa cache in the live discovery service.
Replace storage with `CountryLinqaDistributedCache`.
Keep the existing post-fetch authorization loop and make it explicit:
cache hit -> block check -> restricted-user check -> mutual discovery/privacy check -> return.

If Redis is unavailable, execute uncached. Never fail open on privacy.

## 3. Preserve bounded ranking but make it operationally tunable
Replace literal `300` candidate fetch limits with:
`countryLinqaCandidatePoolLimit()`.
Default stays 300. Hard maximum is 1000.
This closes the hard-coded scaling gap without allowing an unbounded query.

## 4. Database tests
The 41 skipped tests are not a product failure when DATABASE_URL is absent locally.
For certification/CI, skipping is unacceptable.
Use `LINQA_REQUIRE_DB_TESTS=1` + DATABASE_URL and run both the existing chat integration
suite and the 13 CountryLinqa integration tests through the repository's real test scripts.

Do not run an unreviewed destructive suite against a shared dev database.
Use a dedicated CI/test PostgreSQL database.

## 5. Commit isolation
Because unrelated Copilot edits are present, do NOT `git add -A`.
Use `scripts/commit-countrylinqa-only.ps1`, inspect the staged list, then commit.
If a shared file contains both Copilot and CountryLinqa hunks, use `git add -p <file>` manually.

## 6. Physical certification
CI can verify manifests and evidence shape, but it cannot create physical evidence.
Use two physical devices/accounts whose verified countries differ.
Bind evidence to exact Git SHA + server/mobile SHA-256.
Keep iOS blocked until a real iOS target/artifact exists.
