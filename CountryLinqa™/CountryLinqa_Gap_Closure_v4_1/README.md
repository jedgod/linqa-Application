# CountryLinqa™ Repo-Native Gap Closure v4.1

This patch closes the software/CI gaps that remain after the repo-native integration.

Decisions intentionally preserved:
- NO "online now" stranger filter. Presence stays private.
- NO duplicate moderation service. Reuse existing block/restricted-user enforcement.
- Ranking remains bounded, but the candidate window is configurable and hard-capped.
- Physical two-country certification remains an execution gate, not something CI can fabricate.
- iOS remains blocked until a real iOS project/build target exists.

What this patch changes:
1. Replaces process-local discovery cache with a shared Redis-compatible cache adapter.
2. Keeps privacy independent from cache: every cached page is re-authorized before response.
3. Adds policy-versioned keys and invalidation.
4. Makes candidate pool limit configurable (default 300, hard maximum 1000).
5. Adds DB-required test gate so CI cannot silently skip PostgreSQL integration tests.
6. Adds skipped-test audit/reporting.
7. Adds CountryLinqa exact-SHA certification manifest and physical evidence verifier.
8. Adds an isolated Git commit helper so CountryLinqa changes can be committed without
   sweeping unrelated Copilot edits into the same commit.

Adapt imports to the live Linqa Redis/config/logger primitives if equivalent helpers already exist.
