# CountryLinqa security assessment remediation

Source: `securityassessclaude.txt`. Changes preserve the existing block, armed chat-intent and HTTPS payment-link fixes.

| Finding | Implementation | Status |
| --- | --- | --- |
| S01 | Fastify 5.12.5, compatible dependency patches, Vitest 5.0.3; CI fails on high/critical dependency findings. | Server audit: zero findings. |
| S02 | Client claim/SIM/locale excluded from authorization scoring. Missing trusted phone country cannot verify. Review/restricted states deny retries. A transaction locks the user and rechecks state before writing evidence and authorization. Five confirmation attempts per user per hour; rejected requests are logged. | Implemented. |
| S03 | PostgreSQL atomic shared quotas for every CountryLinqa route: coarse IP 120/minute, user reads 120/minute, writes 60/hour, individual write routes 30/hour. Existing stricter route limits remain. User quotas contain no IP. Store failures deny access. Each quota write prunes up to 100 expired buckets without waiting on other cleanup locks; the cleanup job also deletes expired buckets. | Implemented for CountryLinqa. The application's separate global limiter remains an additional process-local guard. |
| S04 | Validated `TRUSTED_PROXY_CIDRS` controls Fastify proxy trust. Defaults to direct-access behavior; arbitrary forwarded headers remain untrusted. | Code implemented; deployment must supply its exact proxy addresses/CIDRs. |
| S05 | Declined/cancelled requests have a 30-day cooldown. Live pending retries preserve timestamps. Creating requests locks the sender and caps active outgoing requests at 50. | Implemented. |
| S06 | Business discovery uses shared verified-owner, block, moderation, entitlement and exact-state visibility predicates with bounded pagination. | Implemented. |
| S07 | Country route wrappers expose only explicitly allowed domain codes; unknown/database errors return generic 500 responses and are logged. | Implemented. |
| S08 | Missing scope returns explicit `FORBIDDEN` 403, including plan routes. | Implemented. |
| S09 | Native cryptographic UUID checkout keys; lookup and unique index scoped to user; provider key includes user namespace. A locked transaction serializes same-user checkout attempts. | Implemented. |
| S10 | Creating saved searches locks the account and caps active rows at 50. Explicit user deletion removes the owned row and cascading run records. Creation/use/deletion receive shared write quotas. | Implemented. |
| S11 | Chat screen ignores URL-supplied names; people heading ignores URL titles and location labels come from the server catalog. Existing armed chat-intent protection remains. | Implemented. |
| S12 | Compatible mobile dependency updates remove the critical finding; Expo SQLite aligned to SDK 57. CI audits all dependencies. | Partially resolved: 22 mobile audit findings remain (19 high, 3 moderate). |

## Validation

- Server TypeScript compilation passed after the security changes and dependency upgrade.
- CountryLinqa unit/route regressions: 74 distinct checks passed across the focused runs, including eight security regressions for review-state races, IP rotation and public error filtering. The complete app registration/unauthenticated checks also passed.
- Real PostgreSQL plan and world integration checks: 31 passed, with sequential workers and a 60-second cleanup-hook allowance. Includes cross-user idempotency isolation and eight simultaneous retries producing one provider checkout.
- Independent PostgreSQL pools issued 20 simultaneous requests against a quota of five: exactly five succeeded and fifteen returned rate-limited errors. Closing a pool and calling again did not reset the quota.
- Mobile TypeScript compilation passed after compatible dependency updates and URL-parameter hardening; the offline Expo dependency check reports dependencies up to date.
- A fresh local API instance on port 8090 reported ready and returned `401 unauthorized` for an unauthenticated CountryLinqa request.
- Migration `053_countrylinqa_security_hardening.sql` applied locally through the checksum-aware migration runner. No production database migration is claimed.

## Deployment and dependency work still required

Apply migration 053 before starting this code on each deployment. Schedule `npm run db:cleanup` to remove expired quota buckets. Configure only the actual trusted proxy CIDRs; this workspace does not establish production network topology.

Mobile auditing remains a release blocker. `braces` and `node-forge` have no patched published versions in the current advisories: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Metro also depends on the old default export API of `image-size`; its patched major version changes that API. The patched `decode-uri-component` version is ESM while this Expo Router dependency uses CommonJS `require`. Blind overrides or npm's proposed downgrade to Expo 44 would create compatibility problems. These dependencies require compatible upstream updates or separately validated patches; they have not been waived or reported as fixed. Local before/after audit evidence is under `.runtime/biometric-deployment/`.

Native compilation and physical biometric testing are tracked separately in `biometric-deployment-2026-10-06.md`. The patched mobile snapshot compiled successfully in iOS simulator build `94c4853e-09d3-4c33-bc95-36a7a806187e`; Android debug compilation also succeeded. Android device installation was rejected because its existing signing certificate differs from the APK certificate. Neither simulator compilation nor an APK build establishes physical biometric behavior.
