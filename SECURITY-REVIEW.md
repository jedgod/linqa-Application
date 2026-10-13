# Security Review

**Date:** 2026-10-12

## Summary

The page-by-page static review found no new confirmed vulnerabilities in the screens and related API paths it examined. This does not establish that all pages or runtime behavior are secure; see scope limitations below.

## Findings

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | MEDIUM | `linqaChat-And-iOS/linqa-signing.properties` (historical; deleted from current tree) | 3, 5 | Release keystore and key passwords were committed in cleartext. Deleting the file does not remove it from Git history. If the matching keystore is obtained and the credentials remain valid, they could be used to sign a release. This is a previously reported historical exposure, not a newly confirmed flaw in the page paths reviewed. | 8/10 |

## Recommendations

- Rotate the exposed signing credentials. If the keystore or credentials may have been accessed by an untrusted party, assess replacing the signing key. Removing the historical file or rewriting Git history does not invalidate credentials.
- Retain server-side authorization for conversation reads, deletes, attachments, forwarding, event access, vault/account operations, and LinqaSend. Test access controls using multiple accounts and direct API requests, not only the UI.
- Test that secure-message caches do not expose decrypted material after logout or account switching.
- Validate access controls and type/size limits for uploaded attachments/media and location data; exercise rate limits and key-package handling under abuse scenarios.
- Extend the review to every remaining web/mobile screen and validate authorization-sensitive behavior dynamically before treating the application as fully assessed.

## Pages and screens assessed

- Mobile conversation: `/modules/conversation`, `ConversationScreen`, and `ChatActionSheets`, including forwarding and related conversation-service calls.
- Mobile event scheduling: meeting/event composition, conversation event cards, calendar export, reminders, and the Event log screen.
- Web linked-browser chat: message forwarding, `ForwardDialog`, and secure-message opening/caching.
- Related mobile flows: account context, vault access and checkout, and news-link handling.

## Related backend/API paths assessed

- Chat message deletion and visibility, attachment deletion, and historical sender-key lookup.
- Thread attachment/media upload and read paths, location-share handlers, and service authorization.
- Key-package handling, global rate-limit key selection, and API bootstrap/schema-readiness checks.
- Relevant vault, authentication, account-deletion, and LinqaSend route authorization patterns.

## Scope limitations

This was a static, scoped review. Conversation, scheduling, forwarding, and associated API paths received the most detailed examination; the reviewer did not individually trace every screen in the large mobile/web route inventory. Deployed configuration, provider behavior, credential validity/rotation, and runtime authorization with live accounts were not verified. Repository access history for the historical credential exposure was not verified.
