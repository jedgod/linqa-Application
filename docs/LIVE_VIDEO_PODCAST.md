# Live Video Podcast: design, security model and build status

Decisions from the product owner (2026-10-24): recorded videos are **end-to-end encrypted** and only friends and family the
user chooses can watch them; a session is **capped at 30 minutes**; extra minutes would be charged, but **no price or billing rule
exists yet, so none is implemented**. Live Rooms stays "coming soon" in the app until phase 3 passes on two physical devices.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Record a video, encrypt it on the phone, post it to status for chosen people | **built and tested without a device or storage; not yet run end to end** (see below) |
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

## Phase 1 phone client

`app/podcast.tsx` (Linqa hub, "Video podcast"): record up to 30 minutes at about 1.5 Mbit/s (a full-length recording is roughly
360 MB, under the 500 MiB the server accepts), choose people, post with live progress and Cancel; a Watch tab lists what was shared
with you, plays it, and lets you take your own posts down.

| Piece | File | How it is verified |
|---|---|---|
| Chunked encryption format | `services/stream-crypto.ts` | 11 unit tests, mutation-checked |
| Upload pipeline: encrypt to a scratch file, create upload, send parts with per-part retry, seal, post | `services/status-video-upload.ts` | `tests/status-video-flow.test.ts` |
| Watch pipeline: open bundle, verify, download, decrypt chunk by chunk, delete on any failure | `services/status-video-view.ts` | same file; 11 tests, 5 mutation checks |
| Sealing a key for an audience (per device, 8-day lifetime, up to 200 devices) | `SecureCoreMessaging.sealForAudience` | `tests/secure-core.test.ts` (27) |
| Real files, HTTP and the account's secure session | `services/status-video-device.ts` | typecheck, and the screens on a Galaxy A03s |

Design points worth knowing:
- The upload API wants the manifest hash before any part is sent, which can only be computed from the finished ciphertext. So the
  phone encrypts the whole recording to a private scratch file (one 5 MiB chunk in memory at a time), then uploads from it. It
  needs free space of about the recording's size; running out is reported as such, and the file is always deleted.
- The sealed key bundle names the upload it was made for, so a server cannot attach it to a different upload.
- The app asks the server's `object-storage` capability first and shows plainly that sharing is unavailable, instead of failing
  after a long encryption.
- Decrypted copies live in a private cache folder and are deleted when the Watch screen closes.

## What has NOT been verified yet (read before relying on this)

- **No end-to-end run.** The pipeline has never run with a real S3-compatible store: this dev machine's API has no object storage
  configured (the local MinIO container exists but is not wired in), and its running API predates the new routes and migration.
  Posting, downloading and playing back a real video on a phone therefore remain untested. The server logic is tested against real
  PostgreSQL with a fake store, and the phone logic against the real secure-core messaging code with a fake native core and fake
  server; the glue between them (presigned part PUT and ETag handling, the file-handle streaming, ExoPlayer on the decrypted file) is
  what is left to prove.
- **Two physical devices.** Sharing needs a second phone with its own account, as does the separate requirement that Live Rooms
  stay "coming soon" until the room feature passes on two devices.
- A recording needs about its own size in free space during posting; very low-storage phones will see the "out of storage" message.
- A completed upload whose post step then fails is left in storage with no post. A cleanup for such orphans is not written.
- Strings on the new screen are English only; they are not in the shared translation catalog yet.
- Backgrounding the app during a long upload may pause or kill it; the screen asks the user to keep Linqa open and keeps the screen awake.

## Known limits and open items

- **Downloads need real object storage.** Posting and watching rely on S3-compatible storage. Production requires a KMS key and
  fails closed without it. For development only, a local MinIO can stand in (see "Local MinIO" below).
- The audience check only covers people who are already contacts or share a conversation. Inviting people who are not yet on Linqa
  is phase 2.
- Extra-minute billing: undefined; needs a price, who is charged and when, and a payments integration.
- Recordings of other people (guests in a live room) need their consent flow; that belongs to phase 3.

## Local MinIO (development only)

`infra/minio/` runs a digest-pinned MinIO on loopback (API `127.0.0.1:19000`, console `127.0.0.1:19001`) with a private bucket
`linqa-video-dev` and a service account limited to that bucket. The generated `.env` and `api-credentials.env` are git-ignored; the
API never uses the root account.

- `LOCAL_MINIO_ENABLED=true` selects a `local-minio` adapter. Config validation rejects it unless `NODE_ENV=development`, requires an
  `http://` endpoint with path-style addressing, and forbids combining it with a KMS key. The adapter repeats those checks.
  Production keeps requiring KMS; that is unchanged and covered by `storage-mode.test.ts`.
- MinIO has no KMS, so objects are not server-side encrypted in this mode. That is acceptable only because the phone encrypts every
  chunk before upload, so the store holds ciphertext either way.
- Upload sessions are bound server-side: the multipart upload id is stored when the upload is created and compared on every part
  signature and on completion; the client's id and key are never forwarded. Completion also validates the part list.
- Uploads carry a `purpose`. Only `STATUS_VIDEO` uploads are eligible for orphan cleanup, through a durable job table
  (`status_video_cleanup_jobs`, migration 090) worked with leases and capped exponential backoff. The phone aborts an unfinished
  upload when the user cancels or posting fails.
- Presigned URLs are host-bound; the phone reaches MinIO through `adb reverse tcp:19000 tcp:19000`, so nothing is exposed to the LAN.

**What this proves:** the S3 transport at Linqa's real chunk size (5 MiB + 16-byte parts accepted, small non-final parts refused),
expiry, host and key binding, private bucket, account scope, abort, and idempotent delete, via `status-video-minio.integration.test.ts`
(opt-in: `LOCAL_MINIO_ENABLED=true` plus the endpoint, bucket and keys).

**What it does not prove:** production storage (KMS, IAM, TLS, lifecycle rules), and anything on a phone. The physical-device
matrix (record, upload, publish, watch, tamper, cancel, kill, low disk, delete, expire, account switch, outage, restart, second
device) has **not** been run; it needs hands on the phones. Production remains blocked.
