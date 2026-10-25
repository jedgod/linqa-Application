# Live Video Podcast: design, security model and build status

Decisions from the product owner (2026-10-24): recorded videos are **end-to-end encrypted** and only friends and family the
user chooses can watch them; a session is **capped at 30 minutes**; extra minutes would be charged, but **no price or billing rule
exists yet, so none is implemented**. Live Rooms stays "coming soon" in the app until phase 3 passes on two physical devices.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Record a video, encrypt it on the phone, post it to status for chosen people | **server done and tested; phone client not built yet** |
| 2 | Invites: single-use hashed tokens, UUID and device bound, system contact picker, `linqa://` link | not started |
| 3 | Live room as a host-led wrapper over the existing mesh (`features/call-rooms`), key rotation for removals | not started |

## Phase 1 security model

What the server stores: the ciphertext (an ordinary completed attachment upload), who may fetch it, when it expires, and one opaque
sealed bundle per allowed **device**. It never holds a key, nonce, caption, MIME type or chunk layout. A test asserts the schema
has no key-like column other than `status_video_recipients.sealed_key`.

Encryption (`clients/mobile/services/stream-crypto.ts`, 11 tests, mutation-checked): XChaCha20-Poly1305 over 5 MiB chunks (one S3
multipart part each, so a phone holds one chunk at a time and the 25 MB whole-file limit does not apply). Each chunk's nonce is a
random 16-byte prefix plus the chunk index; its AAD binds recording id, owner, MIME type, chunk size, chunk count and index.
Because those values come from the sealed bundle, not the server, a malicious server cannot truncate, extend, reorder, duplicate
or substitute chunks, or move them to another recording. Limit: 500 MiB of ciphertext, 10,000 chunks (the server's own limits).

Audience (`server/src/services/status-video.service.ts`): a recipient is accepted only if they are connected to the owner (a
contact either way, or a shared conversation both are still in) and neither has blocked the other, and each device listed is an
ACTIVE device of that user. The check runs again on every read, so a block takes effect immediately. A refusal never says which
person failed (that would reveal blocks); unknown, expired, taken-down and not-addressed-to-you posts are indistinguishable (404).

Lifecycle: posts expire after 24 h by default (7 days at most). Expired or removed posts lose every sealed key at once and their
ciphertext is deleted; the post row stays as an audit record. A `STATUS_VIDEO` row in `retention_overrides` (safety report, legal
hold, security incident) still revokes all access but keeps the ciphertext. `npm run jobs:status-video-expiry` performs the
deletion and should run every few minutes (cron or a Kubernetes CronJob); until it runs, expired posts are already hidden.

API (all device-bound; posting needs `status:write`, watching needs `status:react`):
`POST /v1/status-videos`, `GET /v1/status-videos/feed`, `GET /v1/status-videos/mine`, `POST /v1/status-videos/:id/download`,
`POST /v1/status-videos/:id/viewed`, `DELETE /v1/status-videos/:id`. Migration: `088_status_video_posts.sql`.

## Not done yet in phase 1 (the phone side)

1. Record up to 30 minutes (today's recorder stops video at 2 minutes).
2. Chunked encrypt and multipart upload to the existing attachment API, never holding more than one chunk in memory.
3. Seal the key bundle to each chosen friend's devices. `SecureCoreMessaging.seal` is tied to a conversation's members, so it needs
   an audience-based variant.
4. Pick the audience, post, watch (stream-decrypt to a private cache), and take down.

## Known limits and open items

- **Downloads need real object storage.** Posting and watching rely on S3-compatible storage with a KMS key; without it the server
  fails closed. The local MinIO container is not configured for the API, so none of this can run end to end on a phone until it is.
- The audience check only covers people who are already contacts or share a conversation. Inviting people who are not yet on Linqa
  is phase 2.
- Extra-minute billing: undefined; needs a price, who is charged and when, and a payments integration.
- Recordings of other people (guests in a live room) need their consent flow; that belongs to phase 3.
