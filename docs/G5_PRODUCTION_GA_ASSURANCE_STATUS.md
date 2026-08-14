# G5 Production GA Assurance Status

Assessment date: 2026-08-09

## Implementation verdict

The code-controlled G5 setup is implemented. It includes exact G5-A through G5-K requirements, signed assurance bundles, immutable artifact registration, content and manifest hashes, independent-review enforcement, G0-G5 same-revision admission, supply-chain scanning, KMS operations, secret rotation, SIEM redaction, SLO/paging definitions, DR/load/chaos policies, mobile release assertions, canary/rollback controls, and a protected tag workflow.

## Local verification

- Server TypeScript production build: passed.
- Server regression: 31 test files and 119 tests passed.
- G5 focused assurance and operations tests: 9 passed.
- Mobile TypeScript validation: passed.
- Server production dependency audit: zero vulnerabilities.
- Web production dependency audit: zero vulnerabilities.
- G5 workflow YAML and gate configuration JSON: parsed successfully.

## Current GA blockers

G5 must not yet be labeled GREEN:

1. The mobile Expo 52 production dependency graph reports 25 advisories: 4 moderate, 20 high, and 1 critical. The complete npm remediation upgrades to Expo 57 and is breaking, so it requires a separate framework migration plus Android/iOS regression and signed-device testing.
2. No protected-CI G0-G4 evidence archive has been supplied for the release revision.
3. No trusted Ed25519-signed G5 bundle containing the actual G5-A through G5-K reports and approvals has been supplied.
4. Independent crypto review, penetration test, privacy/legal review, DR/load/chaos execution, signed iOS/Android candidates, canary/rollback proof, and five-role go/no-go remain external activities.

The workflow fails closed on all four conditions.

## Required protected CI configuration

- Environment: `ga-approval`, with required reviewers.
- `LINQA_G0_G4_EVIDENCE_URL`
- `LINQA_G0_G4_EVIDENCE_SHA256`
- `LINQA_G5_EVIDENCE_BUNDLE_URL`
- `LINQA_G5_EVIDENCE_BUNDLE_SHA256`
- `LINQA_EVIDENCE_TOKEN`
- `LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM`

Both archives must match their protected SHA-256 values and contain no traversal paths or symbolic links. The G5 archive must contain `signed-assurance.json` and every artifact referenced by its signed payload. Every artifact must match its declared size, SHA-256, revision, release version, environment, producer, and freshness constraints.
