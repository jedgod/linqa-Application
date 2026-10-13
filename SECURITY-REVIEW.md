# Security Review — Expanded Follow-up

**Date:** 2026-10-12

## Summary

Local Git evidence confirms a historical release-signing credential exposure. No new application-code vulnerability was confirmed in the follow-up, but the full mobile/web route inventory and all server routes were not reviewed. Production configuration, providers, credential validity, and live authorization remain unverified; this is not a full security clearance.

## Finding

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | `linqaChat-And-iOS/linqa-signing.properties` (historical; deleted from working tree) | 3, 5 | Non-empty release keystore and key passwords, with keystore path and alias, were committed in cleartext. The credential-bearing commit remains reachable in Git history; if the matching keystore is available and the credentials are valid, they could enable release signing. | 9/10 |

## Historical exposure evidence

- Local Git inspection found the credential file at commit `77fcf52`; the secret values are intentionally not reproduced here.
- Commit `d852fcb` deleted/untracked the file but did not purge its earlier blobs.
- As of the last local fetch, `77fcf52` is reachable from `agent/production-module-hardening` and `remotes/origin/agent/production-module-hardening`, but not from `main` or `origin/main`.
- No evidence of credential/key rotation or history rewrite was found in the inspected checkout. Whether a matching keystore was ever committed was not established.
- Remote reachability does not establish repository visibility or who accessed it. Current visibility, collaborators, forks, clones, and audit logs are not available in the local checkout.

## Previously reviewed screens and paths

- Mobile conversation: `/modules/conversation`, `ConversationScreen`, and `ChatActionSheets`, including forwarding and related conversation-service calls.
- Mobile event scheduling: event composition, conversation event cards, calendar export, reminders, and the Event log screen.
- Web linked-browser chat: forwarding, `ForwardDialog`, and secure-message opening/caching.
- Related mobile flows: account context, vault access and checkout, and news-link handling.
- Related backend paths: chat deletion/visibility, attachment operations, sender-key lookup, thread media, location share, key packages, rate-limit key selection, schema readiness, vault/authentication/account deletion, and LinqaSend authorization patterns.

These earlier checks were scoped and do not mean every screen or corresponding API was traced.

## Coverage not completed

- Mobile pages in `clients/mobile/app/**` and web pages in `clients/web/src` were not individually enumerated and traced end-to-end in the expanded follow-up.
- Approximately 448 server route registrations across 68 files were counted, not individually reviewed for authentication, authorization/IDOR, injection, SSRF, path traversal, uploads, or rate limits.
- Other client folders (`clients/android`, `clients/ios`, `clients/shared`) and prototype/page-code packs were not comprehensively reviewed.
- Higher-priority pending areas include `server/src/routes/vault-intake.ts`, `server/src/routes/linqasend/advanced-routes.ts`, `server/src/services/storage/local-vault-object-storage.ts`, `server/src/routes/calls.ts`, `server/src/routes/device-links/`, `server/src/routes/history-transfer/`, and `server/src/routes/countrylinqa/`. These are review priorities, not confirmed vulnerabilities.

## Deployment and live verification

Deployment manifests/configuration, production TLS/WAF/secrets-manager state, CI behavior, and actual deployed settings were not validated. Push, OTP/SMS, TURN, storage, AI, KMS, and other provider behavior were not tested with provider accounts. Runtime authorization with live accounts was not tested.

Credential validity and rotation require authorized access to the keystore and signing-console records. Repository access history requires authorized GitHub audit/visibility/collaborator/fork data. These were not available locally. No production probing or credential use was performed.

## Recommendations

1. Treat the historical signing credentials as compromised; rotate passwords and replace/reset the signing key through supported platform processes. Confirm and record completion with the release owner.
2. Determine in a controlled environment whether a matching keystore exists in current/history and whether the credentials remain active; do not print secret values.
3. Ask an authorized repository administrator to review visibility, collaborators, forks, audit logs, secret-scanning alerts, and push-protection events. Coordinate any history cleanup; rewriting history does not revoke credentials.
4. Add ignore rules for `*.jks`, `*.p12`, `*.pfx`, `*.mobileprovision`, `server/.local-vault/`, and `server/key-directory/`; enable secret scanning and push protection. `.gitignore` already ignores `**/linqa-signing.properties`.
5. Complete the route-by-route review and trace sensitive screen operations to API authentication, ownership/authorization, validation, and rate limits.
6. Review deployment/CI configuration and provider settings with authorized production owners.
7. With authorized test accounts, dynamically test cross-account access, IDOR, logout/account-switch leakage, uploads, and role/ownership boundaries.

## Limitations

Static review only; no comprehensive dynamic test or penetration test was performed. The expanded route trace stopped before covering the full mobile/web inventory and all server routes. Deployed configuration, provider behavior, credential validity/rotation, repository access history, keystore existence/accessibility, and runtime authorization remain unverified. Absence of findings in unreviewed areas is not evidence those areas are secure.
