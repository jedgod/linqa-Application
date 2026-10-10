# What to do when the gate is red

Do not create a new architecture pack.

- Migration failure -> correct only the failing migration/repo schema assumption.
- Typecheck failure -> correct only the reported contract/import.
- DB test failure -> reproduce against dedicated test PostgreSQL and patch the failing behavior.
- Redis test failure -> preserve cache-miss fallback and privacy recheck.
- Skip detected -> remove accidental hard-coded skip/only; do not force unrelated environment-dependent tests to run without prerequisites.
- Physical failure -> preserve evidence, patch observed behavior, rebuild, generate new artifact hash, rerun failed scenario and regression matrix.
- SHA mismatch -> never edit evidence to match; rebuild/retest the exact release.
