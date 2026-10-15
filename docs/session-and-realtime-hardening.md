# Session and realtime hardening

Implemented October 15, 2026, adapting the fourth security architecture blueprint to the existing application.

## Persistent authorization

`server/src/auth/active-principal.ts` centralizes active device and session checks. A device must belong to the token's user, have ACTIVE status and have no revocation timestamp. When a token includes a session ID, that session must belong to the same user and device, be unrevoked and be unexpired. PostgreSQL remains authoritative; a Redis marker expiring after 30 days cannot reactivate a device.

This policy now protects chat inbox/read routes, chat-v2 routes, thread routes, mobile hub operations and both main mobile realtime endpoints. Upload authorization is checked before reading a media upload body. The authenticated rate-limit key also excludes revoked sessions from account-specific buckets. Refresh-token rotation checks persistent device/session authorization before issuing another access token; database outages remain ordinary service failures rather than invalid-refresh-token errors.

JWT verification now requires subject, user ID and expiration claims in addition to its existing issuer, audience and algorithm constraints. Native first-party tokens already include these claims. Signed tokens without expiration are rejected. Existing pre-enrollment scopes and public authentication/health endpoints are preserved; a blanket messages:read middleware was not added to unrelated routes.

## Established sockets

`server/src/realtime/session-guard.ts` rechecks authorization before guarded traffic and every 15 seconds while idle. Database errors, expired tokens and revoked principals close the socket. The hub authorizes each queued outbound event, preserving event order. A slow consumer is closed when its socket buffer exceeds 1 MiB or its pending authorization queue reaches 128 entries. The chat realtime message handler and mobile-hub ping handling also recheck authorization before handling frames.

Idle detection is bounded by the polling interval and database latency. Events already sent cannot be recalled, and authorization remains subject to normal races with concurrently committed revocations. This is not an instantaneous global revocation guarantee. Other socket families, such as call signaling, were not comprehensively audited by this pass.

A separate lifecycle bug was fixed in hub cleanup: an old socket's cleanup can no longer remove a newly connected socket's device registration.

## API headers and existing architecture

The API now serves an explicit CSP with default-src, object-src, base-uri, frame-ancestors and form-action set to none, alongside existing Helmet protections and rate limiting. This policy applies to API responses; it does not configure separately hosted web pages.

The blueprint's examples were not copied over working infrastructure. Linqa keeps its existing JWT claim names, authorization headers, Fastify plugin layout, native Rust encryption bridge, encrypted attachment tables, account storage, database migrations and signed release pipeline. No duplicate attachment schema, query-string bearer tokens, simulated Rust module or TTL-only revocation service was introduced. Existing CI keeps PostgreSQL in the same job as its tests.

## Validation and limits

The named chat security suite now includes session lifecycle and real PostgreSQL session-revocation tests. They cover rejecting an already-issued access token after logout, session expiry, cross-user session substitution, revoked devices during refresh, established-socket revocation, database failure handling, idle timer cleanup, ordered outbound delivery, slow consumers, replacement connection cleanup, mandatory JWT expiry and API CSP headers.

Commands from `server/`:

```sh
npm run test:security:chat:db
npm run test:encryption
npm run build
```

This pass does not certify all server routes or providers, replace independent cryptographic review, rotate exposed signing credentials, deploy the modified API, or supply missing signed production-readiness evidence. Other route families need equivalent lifecycle review where they still use signature-only JWT authentication. Source changes take effect after the API is rebuilt/restarted and deployed through the intended process.

Executed results: all 108 named chat-security tests passed against disposable PostgreSQL after migrations, with cleanup completed and no skips. Forty-one broader authentication/authorization tests passed. The eight encryption/storage/audit tests and server TypeScript build passed. No production credentials were used or rotated.
