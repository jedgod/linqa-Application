# Linqa Publishing integration pack

This is an implementation package, **not a deployed or certified production release**. The supplied LinqaCreateEvent.tsx is preserved, and the connected wrapper supplies its `onPublish` callback. PostgreSQL is the authoritative published-event database; Expo SQLite is an offline outbox. Never put DATABASE_URL, S3 credentials, or JWT signing keys in the mobile app.

## Structure
- `server/sql/001_publishing.sql` PostgreSQL schema
- `server/src/index.js` authenticated REST API and private S3 presigned uploads
- `server/src/auth.js` JWT verification against the existing identity provider JWKS
- `mobile/LinqaCreateEvent.tsx` original UI
- `mobile/src/publishing.ts` Expo SQLite outbox, upload and API integration
- `mobile/app/CreateEventConnected.tsx` adapter connecting UI to backend

## Server installation
1. Ensure your existing `users(id)` is UUID and that the user identity in the verified JWT `sub` is the same UUID. If not, adapt the foreign keys and identity mapping BEFORE migration. Do not create a second Linqa users table.
2. `cd server && npm install && cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`). Populate `.env` using secure secrets and a private S3 bucket. Use IAM role credentials in deployment; do not put AWS secrets in `.env` if an IAM role is available.
3. `npm run migrate` then `npm start`.
4. Run behind HTTPS ingress; restrict CORS for web clients, and enforce rate limits and request logging at ingress.

## Mobile installation
1. Copy the `mobile` files into your Expo app, preserving imports or adjusting them to your app's paths.
2. Run the commands in `mobile/required-packages.txt` in your Expo project.
3. Render `<CreateEventConnected config={{baseUrl:'https://your-api-host',getAccessToken: async()=>existingSession.accessToken}} onClose={()=>router.back()}/>` using your real session provider. Do not hardcode tokens.
4. Use `syncPublishingOutbox(config)` on app resume and connectivity restoration (with single-flight locking in your app's job coordinator). Show `listLocalEvents()` in a pending-publications UI; allow manual retry after resolving `needs_attention`.
5. Set a current initial event date in the UI; the supplied reference component intentionally starts at Oct 15, 2026 to match the screenshot.

## API
- POST `/api/publishing/uploads`: `{mimeType,bytes}` -> `{uploadId,url,method,headers}`; upload bytes with PUT before creating event.
- POST `/api/publishing/events`: event payload + `Idempotency-Key` UUID header -> `{id,status}`. A repeated key returns the same event ID.
- GET `/api/publishing/events/:id`: public published events or own event.
- GET `/api/publishing/events`: own and public published events, capped at 50.
- PATCH `/api/publishing/events/:id`: update own published event fields.
- POST `/api/publishing/events/:id/cancel`: cancel own published event.

## Important release blockers / limitations
- `CreateEventConnected` currently publishes with visibility `public`. Integrate CountryLinqa country/community access rules before exposing other visibility modes. Country/community/private access is not implemented in the GET routes; do not expand access until authorization is implemented.
- The existing screen's tag people, GIF and feeling buttons remain UI callbacks; persist these via separate validated relational tables and API endpoints before claiming full feature support.
- The original screen resolves locations only when a `resolveLocation` callback is provided. Integrate an authenticated place-search endpoint and provider. Do not expose a privileged geocoding key in the app.
- Media upload verification checks object existence, content type and byte length; malware scanning, transcoding, moderation, lifecycle cleanup, orphan uploads, quotas, and CDN delivery are NOT implemented. These are release blockers for public media.
- S3 presigned PUT requests can be replayed until expiry. Enforce upload scanning/quarantine and strict object-store policies before public launch.
- Outbox retries currently re-upload media before replaying the event idempotency key, producing orphan upload objects. Add a durable per-attachment upload manifest and orphan cleanup worker for production.
- `expo-file-system` legacy uploadAsync API may require import from `expo-file-system/legacy` in newer Expo SDKs. Adjust to your actual Expo SDK; do not assume compilation without testing.
- The provided mobile adapter returns a queued result when offline. The original screen's own `onPublish` success handling may display a generic success message: inspect it and ensure queued events never display as published.
- This package is not yet validated against your repository's actual user schema, API router, Expo SDK, authentication flow, migrations or devices. Run migration in staging, API tests, mobile typecheck, Android/iOS E2E, reconnect tests, concurrent idempotency tests and S3 failure injection.
