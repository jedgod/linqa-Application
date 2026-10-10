# CountryLinqa™ Certification Execution v4.2

This is NOT another architecture pack. It is the execution layer after v4.1.

It adds:
- preflight certification runner
- dedicated PostgreSQL safety guard
- CI result/evidence collector
- release readiness report
- Android physical-certification evidence template
- deterministic release gate
- rollback checklist

It intentionally does NOT add:
- Online Now/presence discovery
- another moderation service
- another CountryLinqa certification authority
- speculative iOS code

Use the repository's existing `scripts/countrylinqa-certification.mjs` as the
authoritative exact-SHA/physical evidence verifier.
