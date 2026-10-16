# Security review and release decision — 2026-10-16

Decision: hold both merge to main and release tagging. This is a scoped source, dependency and CI review; a full deployed-environment security audit and signing-credential rotation remain incomplete.

## Dependency exceptions

Reviewed the existing owner-accepted mobile exceptions ahead of the 2027-04-15 deadline:

| Package | Reviewed version | Advisory | Result |
| --- | --- | --- | --- |
| braces | 3.0.3 | GHSA-vfj7-8cjw-p6xm | No patched release listed; retain existing scoped exception pending upstream remediation. |
| node-forge | 1.4.0 | GHSA-86w9-cpqp-85rv | No patched release listed; retain existing scoped exception pending upstream remediation. |

Sources: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm and https://github.com/advisories/GHSA-86w9-cpqp-85rv . Registry latest versions matched the reviewed versions. These remain vulnerabilities, not clean audit results. Expo signing tooling depends on node-forge; build-time use still matters for supply-chain security. Runtime bundle exclusion has not been exhaustively established.

`security/dependency-exceptions.json` records scope, rationale and dates. The checker rejects mismatched allowlists, lockfile drift, missing packages, invalid dates and exceptions on or after 2027-04-15. Registry checking fails when unavailable or a new version requires review. Two regression tests passed. Mobile audit-ci passed with the two existing advisory exceptions; the raw audit still reports 25 affected dependency nodes (22 high, three moderate), not 25 unique advisories.

Dependency CI now includes full web tooling audits, exception validation and weekly/April-15 scheduled checks. Scheduled workflows only become active once present on the default branch; no personal reminder was created.

Server npm audit: zero reported vulnerabilities. Web audit initially reported eight affected nodes including high/critical findings. Updated Vite to 8.3.4, Vitest to 5.0.5 and React plugin to 6.1.2, with compatible Node engines and a freshly resolved lockfile. Installation audit reports zero vulnerabilities. This major tooling update requires the build/test results recorded below before merge.

## Release evidence and signing

Reviewed remote head `a216a1eaba8e7d20f19986e15ad2c833d498f1d4` on draft PR https://github.com/jedgod/linqa-Application/pull/1 . Local edits in this review are newer and have not been pushed or validated by hosted CI.

- G0–G4 workflow failed while fetching required signed production/provider/device evidence: https://github.com/jedgod/linqa-Application/actions/runs/38841676841 . Release promotion was skipped.
- Signed API image workflow built and scanned successfully, but production readiness, image publishing and cosign steps were skipped on the PR: https://github.com/jedgod/linqa-Application/actions/runs/38841677038 . It does not prove successful publication or signing.
- Main reported `protected: false`; repository rulesets returned an empty list. Required status checks and release governance need repository-admin review before promotion.

Historical release-signing password exposure remains documented in SECURITY-REVIEW.md. Deleting a tracked password does not revoke copied credentials or signing keys. No release keystore/certificate or authorized signing-provider session was available; only a local Android debug key was found. No credential was rotated and no new production signing identity was generated. Determine whether the exposed material is an Android upload key, app-signing key, iOS certificate or other credential, then use the provider's revocation/reset procedure and verify a signed artifact. Android distinguishes upload-key reset from app-signing-key upgrade: https://developer.android.com/studio/publish/app-signing .

## Application hardening and validation

Extended active device/session checks to call-room and legacy signaling connections, including guarded outbound delivery and idle checks. Legacy signaling now requires calls scope, validates strict frame fields and bounded encrypted payloads, and limits pending work and frame rate. Added vault/call revocation and malformed-frame regression coverage to the security suite. Existing focused run: 16 tests passed across call/vault, desktop-call authentication and session lifecycle. Server TypeScript build passed after the changes.

The fresh expanded database-backed suite could not start: Docker info failed. Earlier 108-test database evidence predates these local additions and is not a replacement for rerunning the expanded suite. No test result has been fabricated.

## Deployed audit and remaining work

No deployed URL/environment was supplied, kubectl has no current context, and the deployment YAML contains a placeholder signed image digest. These facts do not establish the live environment's state. Production TLS/headers, authentication and authorization, session revocation, storage/backups, cloud IAM, secret rotation, image provenance, monitoring and incident response still require authorized deployed checks and the addendum's signed evidence. Local source review cannot establish whether a machine was hacked, nor eliminate exposure on a compromised unlocked client.

Needed inputs: staging/production URL, intended audit environment, signing provider/key identity and authorized account/tool access. Do not paste secrets. Complete rotation and deployed checks, collect genuine signed G1–G4 evidence for the exact candidate revision, rerun local/hosted gates, and review main protection before reconsidering merge or a release tag.

Final web validation: production build passed with a bundle-size warning; all 87 tests passed, and the three messaging-coordinator tests passed again after adding an explicit string check for the transparency public-key environment setting. Fresh installed-graph npm audit reports zero vulnerabilities. Scoped diff whitespace checks and workflow structure validation passed. The warning concerns a 548 kB minified chunk and is not a security audit finding.
