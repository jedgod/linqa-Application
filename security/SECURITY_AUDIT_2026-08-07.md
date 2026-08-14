# Linqa Security Audit — 2026-08-07

Full-application diagnostic covering the Rust crypto core (`core/`), the
Fastify/TypeScript server (`server/`), and the web client (`clients/web/`).
Conducted as a read-only, evidence-based review (file:line citations, not
inference) split across four domains: authentication/sessions,
authorization/multi-tenancy, injection/data-handling/secrets/dependencies,
and cryptography/key-management/realtime-abuse. The two CRITICAL findings
below were independently re-verified by direct code inspection after the
domain review surfaced them; everything else reflects the domain reviews'
own file:line evidence.

This is a snapshot of a system that has clearly been improved iteratively —
one instance of the exact bug class in Finding 1 was already found and
fixed earlier (SCIM/legal-hold routes; see `organization-authorization.service.ts`
and its wiring into `routes/execution-launch.ts`). The findings below are
**new**, not re-reports of that fix.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Enterprise policy write has no organization-authorization check | CRITICAL | **FIXED 2026-08-07** |
| 2 | Collaboration room events have no membership check at all | CRITICAL | **FIXED 2026-08-07** |
| 3 | No revocation check on access tokens (session-id claim unused) | HIGH | Confirmed |
| 4 | Compaction of the durable replay log is not atomic (crash → replay window) | HIGH | Reported, not independently re-verified |
| 5 | Business profile `organizationId` accepted with no membership check | MEDIUM | Reported |
| 6 | Message expiry-receipts accepted for any `messageId` | MEDIUM | Confirmed |
| 7 | Status reactions/replies bypass audience restrictions | MEDIUM | Reported |
| 8 | No per-route rate limiting on auth-sensitive endpoints; unthrottled WS signaling | MEDIUM | Confirmed |
| 9 | `key` (envelope symmetric key) not zeroized on the AEAD-failure error path | MEDIUM | Reported |
| 10 | Passkey routes have no scope restriction beyond "authenticated" | LOW | Confirmed |
| 11 | File Vault `encryptedSize`/`contentType` have no upper bound or allow-list | LOW | Confirmed |
| 12 | Replay log file has no explicit permissions (umask-dependent) | LOW | Reported |
| 13 | CSP disabled in Helmet config, undocumented | LOW | Confirmed |
| 14 | IP-hashing reuses `JWT_HS256_SECRET` instead of a dedicated key | LOW | Confirmed |

Everything not listed above that was in scope (SQL injection, secrets in
source, dependency vulnerabilities, XSS, input-validation coverage, JWT
algorithm confusion, OTP brute-force, device-enrollment Ed25519 verification,
object-storage path traversal, KMS key handling, TURN credentials) came back
**SECURE** — see "Confirmed secure" at the end.

---

## CRITICAL

### 1. Enterprise policy write — no organization-authorization check

**`server/src/routes/milestone-platform.ts:100-121`**
```ts
app.put(
  "/v1/organizations/:organizationId/policies/:policyKey",
  async(request,reply)=>{
    const principal=await authenticate(request);
    requireScope(principal,"enterprise:policy:write");
    const params=z.object({
      organizationId:z.string().uuid(),
      policyKey:z.string().min(2)
    }).parse(request.params);
    const body=z.object({value:z.unknown()}).parse(request.body);

    await services.enterprise.set({
      organizationId:params.organizationId,
      key:params.policyKey,
      value:body.value
    });
```
`requireScope` only checks the caller holds the *global* `enterprise:policy:write`
scope — it never checks the caller is authorized for `params.organizationId`.
`EnterprisePolicyService.set()` writes straight through using the URL param.
This is the identical bug class already fixed for SCIM and legal-hold routes,
in a route that wasn't covered by that fix.

**Exploit:** any token carrying `enterprise:policy:write` (issued for
Organization A) can `PUT /v1/organizations/<org-B-uuid>/policies/dlp` and
silently overwrite Organization B's compliance/DLP/retention policy.

**Fix:** call `services.orgAuthorization.requireScope({ organizationId: params.organizationId, subject: principal.subject, requiredScope: "enterprise:policy:write" })` before `services.enterprise.set(...)`, mapping a denial to 403 — same pattern already used in `routes/execution-launch.ts`.

> **FIXED 2026-08-07.** `routes/milestone-platform.ts`'s policy route now
> calls `services.orgAuthorization.requireScope(...)` exactly as prescribed
> above, denying with `403 organization_forbidden` before the write reaches
> `EnterprisePolicyService.set()`. Covered by
> `tests/organization-authorization.route.test.ts` ("enterprise policy route
> organization authorization" — asserts 204 for a granted org and 403 for
> an ungranted one). Full server suite (67 tests) and `tsc` build green
> after the change.

### 2. Collaboration room events — no membership check at all

**`server/src/routes/milestone-platform.ts:38-63`** and **`server/src/services/collaboration.service.ts`** (full file):
```ts
app.post("/v1/collaboration/rooms/:roomId/events",async(request,reply)=>{
  const principal=await authenticate(request);
  requireScope(principal,"collaboration:write");
  if (!principal.deviceId) { ... }
  const params=z.object({roomId:z.string().uuid()}).parse(request.params);
  ...
  const result=await services.collaboration.append({
    roomId:params.roomId,
    actorDeviceId:principal.deviceId,
    ...
  });
```
```ts
export class CollaborationService {
  async append(input:{roomId:string; ...}) {
    if (input.ciphertext.length < 16) throw new Error("invalid ciphertext");
    const result = await this.db.query(
      `INSERT INTO collaboration_events(room_id,actor_device_id,event_type,ciphertext,logical_clock)
       VALUES($1,$2,$3,$4,$5) ...`,
      [input.roomId, ...]
    );
```
There is no `collaboration_rooms` participants/membership table referenced
anywhere in this service. Any authenticated device holding the generic
`collaboration:write` scope can post `WHITEBOARD_DELTA`, `TASK_CREATE`,
`POLL_VOTE`, `SCREEN_SHARE_START`, etc. into **any** room UUID it can
guess or observe — there is no ownership boundary at all, not even a
weak one. (The service also has a `pull()` read method, but it is not
wired to any route today, so the live, reachable exploit is write/injection,
not read.)

**Exploit:** as any authenticated user with `collaboration:write`, POST
events into a room UUID belonging to a different team/workspace — inject
fake tasks, poll votes, or spurious screen-share-start events into a
meeting you were never invited to.

**Fix:** requires a real fix, not just wiring an existing service (no
membership concept currently exists for collaboration rooms). At minimum,
add a `collaboration_room_members` table and check `roomId` + `principal.userId`
membership before every `append`/`pull` call; this needs a small schema
addition, not just route wiring.

> **FIXED 2026-08-07.** Investigation found `collaboration_rooms` (with
> `owner_user_id`) and `collaboration_subscriptions` (`room_id, device_id`)
> already existed in the schema (migrations 007/008) but were never
> populated or checked by any service or route — the whole room lifecycle
> was dead schema. Rather than a minimal patch, this was closed by making
> the feature real:
> - Migration `016_collaboration_room_membership.sql` adds `user_id` and
>   `removed_at` to `collaboration_subscriptions`, turning it into a real,
>   soft-removable membership table (mirrors the `user_id`/`device_id`/
>   removal-marker shape `group_memberships` already uses elsewhere).
> - `CollaborationService` (`server/src/services/collaboration.service.ts`,
>   rewritten) gained `createRoom` (creates the room, auto-subscribes the
>   owner's device, in one transaction), `invite` (owner-only, verifies the
>   invitee device actually belongs to the invitee user before subscribing
>   it), and `removeParticipant` (owner-only, refuses to remove the owner).
>   `append`/`pull` now both call a shared `requireActiveMembership(roomId,
>   deviceId)` check — room must exist and be `ACTIVE`, caller's device must
>   have an unremoved subscription — before touching `collaboration_events`.
> - New routes in `routes/milestone-platform.ts`: `POST /v1/collaboration/rooms`,
>   `POST .../rooms/:roomId/participants`, `DELETE .../participants/:deviceId`,
>   and `GET .../rooms/:roomId/events` (the previously-dead `pull()` is now
>   reachable, gated on a new `collaboration:read` scope). The existing
>   `POST .../rooms/:roomId/events` route needed no route-level change — the
>   membership check now lives in the service itself.
> - Covered by `tests/collaboration.service.test.ts` (11 unit tests: room
>   creation, owner-only invite/remove, device-ownership verification on
>   invite, owner-removal refusal, and membership enforcement on both
>   `append` and `pull`) and `tests/collaboration.route.test.ts` (4
>   integration tests against a booted app, including a live
>   "user-mallory, who was never invited, cannot post into user-owner's
>   room" case). Full server suite (67 tests) and `tsc` build green after
>   the change.

---

## HIGH

### 3. No revocation check on access tokens

**`server/src/auth/jwt.ts`** (verification path) never checks the JWT's
`sid` (session-id) claim against `auth_sessions.revoked_at`. Refresh-token
rotation and reuse detection are real and well-implemented (row-locked,
revokes the whole token family on reuse — see `session.service.ts:66-137`),
but that only protects the *refresh* flow. A revoked/logged-out session's
**access token** remains valid for up to its full 15-minute TTL with no
server-side check, even though the `sid` claim already exists in every
token (`tokens.ts:30`) and `auth_sessions.revoked_at` already exists in the
schema — the two are simply never cross-checked in `authenticate()`.

**Impact:** bounded to a ≤15-minute window per revoked session, but it means
"log out everywhere" / admin-revoke-session flows do not take effect
immediately.

**Fix:** add a cheap `auth_sessions` lookup (or Redis-cached revocation set,
if a DB hit per request is too costly) keyed on `sid` inside `authenticate()`,
rejecting tokens whose session is revoked.

---

## MEDIUM

### 4. Non-atomic replay-log compaction

`core/src/replay.rs`'s `FileReplayStorage::rewrite()` truncates the durable
replay log in place and writes retained entries directly — no
write-to-temp-file-then-rename. A crash between truncate and the write
completing leaves the log partially written; on restart, IDs that were
legitimately "seen" pre-crash may no longer be in the reloaded set,
re-opening a narrow window for the exact envelope(s) in flight at crash
time to be replayed successfully. **Fix:** write to a temp file in the same
directory, `fsync`, then atomically `rename()` over the target.

### 5. Business profile accepts an unverified `organizationId`

**`routes/execution-launch.ts:137-164`**, `business-profile.service.ts` — a
caller can set `organizationId` on their own business profile with no
check that they actually belong to that organization, letting a user
falsely claim organizational affiliation in a directory/trust surface.

### 6. Message expiry-receipts accepted for any `messageId`

**`routes/final-unwired.ts:74-90`**, `disappearing-message.service.ts` —
confirmed: `recordReceipt({messageId, deviceId, receiptType})` inserts with
no check that `messageId` belongs to a conversation the caller's device is
part of. Mitigated in practice by `messageId` being an unguessable UUID
(this pollutes audit/compliance records for a message you'd need to already
know the ID of — not a broad enumeration vector), but still a missing
authorization check worth closing.

### 7. Status reactions/replies bypass audience restrictions

**`routes/next-mobile-features.ts:131,160`** — no check that the caller is
within a status's configured audience (`CONTACTS`/`CLOSE_FRIENDS`/`CUSTOM`)
before allowing a reaction or reply, letting a non-audience user interact
with (and thereby confirm the existence/timing of) a restricted status by
guessing/enumerating its UUID.

### 8. No per-route rate limiting on sensitive endpoints; unthrottled WS signaling

Only one global rate limiter exists (`app.ts:57-60`, 120 req/min per IP,
covering all routes indiscriminately). Auth-sensitive endpoints (refresh,
passkey ceremonies) get no tighter budget than any other route — OTP itself
is separately protected by real DB-enforced per-identifier caps, so this is
lower-risk there, but still worth route-specific limits on refresh/passkey.
Separately, and more concretely: **the call-signaling WebSocket
(`realtime/signaling.register.ts:67-114`) has no rate limiting on inbound
messages at all** — `@fastify/rate-limit` only governs new HTTP requests,
not messages over an already-open WS connection. A single authenticated
device can flood `OFFER`/`ICE_CANDIDATE` events, each triggering a DB write
and hub fan-out, with zero throttle.

### 9. Envelope symmetric key not zeroized on the AEAD-failure error path

**`core/src/envelope.rs`**, both `encrypt()` and `decrypt()`: `derive_key()`
returns a bare `[u8; 32]` (not a zeroizing type), and the code relies on a
manual `key.zeroize()` call placed *after* the AEAD operation. In `decrypt()`
specifically, the `?` on the AEAD-decrypt failure (line ~181, the exact path
an attacker hits by sending a tampered/forged envelope) returns before
`key.zeroize()` runs, leaving the derived per-message key unzeroized in the
popped stack frame. Modest severity (per-message derived key, stack memory
only, not a long-term secret) but a real gap versus the stated zeroization
intent, and directly attacker-reachable. **Fix:** use `zeroize::Zeroizing<[u8;32]>`
for `key` in both functions instead of manual `.zeroize()` calls, so it's
zeroized on every exit path including early returns.

---

## LOW / HARDENING

### 10. Passkey routes: no scope restriction beyond "authenticated"

`routes/passkeys.ts` — all four endpoints call `authenticate(request)` with
no `requireScope`, so any valid token for a user (including the deliberately
low-privilege token issued mid-OTP-flow) can drive full passkey
registration/authentication. Plausibly intentional (bootstrapping a new
device is the whole point of that low-priv token), but worth an explicit
scope rather than implicit "any token for this user".

### 11. File Vault has no upper size bound or content-type allow-list

`file-vault.service.ts`/`routes/file-vault.ts` validate `encryptedSize` as
merely "a positive integer" (no cap), unlike attachments' explicit 500MB
ceiling, and accept an arbitrary caller-supplied `contentType` string with
no allow-list. Low exploitability (content is already client-side
E2E-encrypted ciphertext, and the presigned PUT's `ContentLength` still
bounds actual bytes), but an easy, cheap consistency fix.

### 12. Durable replay log: no explicit file permissions

`core/src/replay.rs`'s `FileReplayStorage::open` doesn't set an explicit
mode; permissions fall to the process umask. On a shared host this could
leave message-ID/timing metadata world-readable. Recommend
`OpenOptionsExt::mode(0o600)` on Unix.

### 13. CSP disabled in Helmet, undocumented

`server/src/app.ts:47-50`:
```ts
await app.register(helmet, { global: true, contentSecurityPolicy: false });
```
Low practical impact today (pure JSON API, no HTML responses found anywhere
in the server), but it's a blanket override with no comment explaining why,
so it would silently carry forward if an HTML-serving path (docs UI, admin
panel, error pages) is ever added. Either add a scoped CSP or a one-line
comment justifying the disable.

### 14. IP-hashing reuses the JWT signing secret

`hashIp(config.JWT_HS256_SECRET, ...)` (`auth.ts`, `auth-challenge.service.ts`,
via `security/hash.ts`) reuses the JWT HMAC signing secret as a hashing key
for IP addresses — a key-separation violation (no direct exploit found, but
best practice is a dedicated secret per purpose). Recommend a dedicated
`IP_HASH_SECRET`.

---

## Confirmed secure (no action needed)

- **JWT verification** (`auth/jwt.ts`): algorithm pinned per code path (no
  alg-confusion), production hard-fails without `JWT_JWKS_URL`, audience/
  issuer enforced, scopes can't be forged without a valid signature.
- **Refresh-token rotation & reuse detection**: genuinely enforced,
  row-locked, revokes the whole token family on replay.
- **OTP flow**: CSPRNG-generated, scrypt-hashed, constant-time compared,
  layered DB-enforced brute-force limits (5 attempts/challenge, 5
  challenges/hour/identifier), correct enumeration protection.
- **Device enrollment**: the real Ed25519 proof verifier (recently wired
  into `routes/enrollment.ts`/`auth/enrollment-proof.ts`, replacing the old
  fail-closed-503 stub) does genuine, constant-time-by-construction
  (OpenSSL Ed25519) signature verification, with correct challenge
  single-use and expiry-binding. `enrollment-v2.ts` and the old
  `gap-closure.ts` enrollment handler are confirmed dormant/unregistered —
  only one enrollment path is actually live.
- **SQL injection**: every query in the entire server is parameterized;
  zero string-built SQL found.
- **Secrets in source**: no real secrets found anywhere in the repo — only
  placeholder/example values; required secrets have no insecure defaults
  and fail startup if missing.
- **Object storage**: `objectKey` is always server-constructed from the
  authenticated user ID + a random UUID, never from user-supplied strings
  — no path traversal or key-collision/overwrite is possible; every
  read/update is filtered by owner in SQL.
- **Dependencies**: zero production-dependency vulnerabilities in both
  `server/` and `clients/web/` (`npm audit --omit=dev`); the web client's
  known dev-toolchain advisories (vite/vitest/esbuild) are pre-existing and
  don't ship to production.
- **XSS**: no `dangerouslySetInnerHTML`/`innerHTML` usage anywhere in the
  web client; the server never renders HTML.
- **Input validation**: every route consistently validates `body`/`params`/
  `query` via Zod before use — zero unvalidated routes found.
- **Hybrid PQ crypto** (`core/src/crypto/`): correct HKDF domain separation
  between KEM-combination and envelope-key-derivation stages, fresh nonces
  per message, no non-constant-time secret comparisons, secret-holding
  structs correctly `Zeroize`/`ZeroizeOnDrop` (except the one gap in
  Finding 9).
- **`MAX_ENVELOPE_BYTES`**: actually enforced server-side (Fastify body
  limit + explicit route-level check), not just documented.
- **TURN credentials**: short-lived (10 min), scope-gated, keyed with a
  dedicated secret distinct from other app secrets.
- **KMS/object-storage config**: KMS key ID and storage endpoint are only
  ever sourced from server config, never from request input; presigned URL
  TTLs are capped server-side regardless of what a caller requests.

## Suggested remediation order

1. ~~Findings 1 and 2 (CRITICAL cross-org/cross-room IDOR)~~ — **both fixed
   2026-08-07**, see the FIXED notes inline above.
2. Finding 3 (session revocation) — closes the "logout doesn't really log
   out for 15 minutes" gap. **Next up.**
3. Finding 4 (non-atomic replay-log compaction) and Finding 9 (key
   zeroization on error path) — both are small, mechanical Rust fixes.
4. Findings 5–8 (medium-severity IDOR/rate-limiting gaps) as a batch.
5. Findings 10–14 (low-severity hardening) opportunistically.
