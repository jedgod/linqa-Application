# How this pack is integrated (Oct 2026)

The supplied code is used as is, with the changes listed here.

| Pack file | Where it lives now | Changes |
|---|---|---|
| `server/sql/001_publishing.sql` | `server/src/db/migrations/075_publishing.sql` | Unchanged, plus one column (`publishing_uploads.received_bytes`). |
| `server/src/index.js`, `validation.js` | `server/src/routes/publishing.ts` | Same routes, request shapes, limits and idempotency. Runs on the app's Fastify server, its sign-in and its database pool instead of a separate Express service. Media bytes go to a signed address on this server (local disk, development only) instead of S3; without storage in production, media is refused and text posts still work. |
| `server/src/auth.js`, `db.js`, `migrate.js` | not used | The app's own authentication, pool and migration runner replace them. |
| `mobile/LinqaCreateEvent.tsx` | `clients/mobile/components/publishing/LinqaCreateEvent.tsx` | Screen layout and behaviour unchanged. Added: optional `heading`, optional `keepFile` (keeps a picked photo past Android's cache clearing), map loaded only if `react-native-maps` is installed, start time of now + 1 hour instead of the fixed Oct 15, 2026. |
| `mobile/src/publishing.ts` | `clients/mobile/lib/publishing/publishing.ts` | Imports adjusted; relative upload address resolved against the API address; single-flight sync; reports the outbox's real status when another sync already handled the item. |
| `mobile/app/CreateEventConnected.tsx` | `clients/mobile/components/publishing/CreateEventConnected.tsx` | Adds a phone-side place lookup, the photo keep step and a published callback. |

Integration with the rest of the app: `app/countrylinqa/create.tsx` (Post and Event shortcuts, close returns to Home),
`lib/publishing/integration.ts` (a published item is added to the person's own events: Upcoming on Home and Calls, Event log),
`hooks/usePublishingSync.ts` (sends offline items when signed in, on resume and every minute), mounted in `app/_layout.tsx`.

Still open from the pack's own list: visibility other than `public`, tag people / feeling / GIF persistence, malware scanning of
media, object storage for production, an orphan-upload cleanup job, and a feed screen that shows other people's published posts.
