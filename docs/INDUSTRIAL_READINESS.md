# Industrial Readiness

This repository contains remediation boundaries and executable local checks. It is not a production-readiness claim.

## Verified Locally

- Rust envelope V1 canonical framing, malformed/trailing/version/expiry negatives
- Byte-for-byte Rust and web fixture compatibility
- Rust formatting, strict Clippy, and all 20 core/unit/integration tests
- Clean PostgreSQL 18 migration sequence `001` through `021`
- Atomic key-package replacement and transparency append
- Server TypeScript build and all 98 server tests
- Web production build and all 18 web tests
- Expo mobile TypeScript check and Android production export
- Transactional call-history, media-index, and release-approval invariants
- Organization-scoped authorization and signed device-enrollment proof checks

## Open Release Gates

- Android, iOS, and desktop byte-for-byte fixture execution
- Independent review and expanded known-answer/interoperability vectors for the implemented hybrid ML-KEM construction
- Reviewed MLS implementation; current provider intentionally fails closed
- Production validation of the implemented S3 object-storage adapter with KMS, access logging, lifecycle deletion, and outage tests
- Signed backup API integration and disposable restore drill
- Hardware-backed custody validation on physical supported devices
- Penetration, tenant-isolation, chaos, canary rollback, privacy, and legal reviews
- Production SLO/alert deployment, SBOM, provenance, and signed store builds
