# Linqa attachment API

Nest module for the share sheet. The relay stores sealed payloads. Poll totals, RSVPs, meeting responses, and live screen-share state are the fields the server is allowed to read so every member can render the cards.

## Routes

- `POST /threads/:threadId/attachments` send a sealed envelope plus the card metadata
- `GET /threads/:threadId/attachments` thread cards for the viewer
- `POST /threads/:threadId/media` upload sealed photo, PDF, voice, or video bytes; returns `storageKey`
- `GET /media/:storageKey` download for a thread member
- `POST /attachments/:id/poll/vote` body `{ picks: number[] }`
- `POST /attachments/:id/rsvp` body `{ value: "going" | "maybe" | "cant" }`
- `POST /attachments/:id/meeting/respond` body `{ value: "accepted" | "suggested" | "declined", suggestedIso? }`
- `POST /ai-images/generate` prompt and style. This is the cleartext exception. Client seals the chosen image before `POST /attachments`.
- `POST /screen-share/:sessionId/end`

Socket namespace `/linqa`:

- `thread.join` `{ threadId }`
- `screen.share` `{ threadId, sessionId, sharedTitle }` emits `screen.live`
- `screen.signal` `{ sessionId, type, payload }` offer, answer, ice, cursor
- `screen.end` emits `screen.ended`
- server emits `attachment.created` and `attachment.updated`

`cleartextException` is rejected unless `kind` is `ai_image`.

Wire `AttachmentsModule` into the Linqa Nest app. `PrismaService` expects the generated client from `backend/prisma/schema.prisma`. Auth must set `req.user.id` and `socket.data.userId`.
