# Gap status after v4.1

CLOSED IN SOFTWARE / CI:
- Shared multi-server cache adapter
- Policy-versioned cache keys
- Privacy recheck after cache hit
- Configurable bounded candidate pool
- Hard candidate maximum
- Required PostgreSQL test gate
- Explicit skip/.only audit
- CI PostgreSQL + Redis services
- Exact-SHA/artifact manifest
- Physical evidence validator
- Isolated CountryLinqa Git commit workflow

INTENTIONALLY NOT ADDED:
- Online-now filter/presence exposure
- Duplicate moderation subsystem

REMAINS EXECUTION-DEPENDENT:
- Physical two-country certification
- iOS project/build/signing and iPhone certification

Therefore, after this patch there should be no reason to invent another architecture pack.
The remaining red gates should represent actual execution evidence or failures found while
applying this patch to the live repository.
