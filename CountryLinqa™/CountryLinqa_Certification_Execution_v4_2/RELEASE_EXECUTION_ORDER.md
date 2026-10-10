# Release execution order

1. Review current `git status`.
2. Stage CountryLinqa-only changes; use `git add -p` on shared files.
3. Commit CountryLinqa separately.
4. Push the branch.
5. Run `countrylinqa-release-gate.yml`.
6. Require PostgreSQL tests to execute with zero skips.
7. Fix only failures actually produced by CI.
8. When green, create the Android release artifact.
9. Hash server and Android artifacts.
10. Run two-device/two-country Android certification.
11. Feed evidence to the existing `countrylinqa-certification.mjs`.
12. Keep iOS explicitly blocked until a real iOS project exists.
13. Approve rollout only when the repository's authoritative release gate is green.
