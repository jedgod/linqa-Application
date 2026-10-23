# Notes, Calendar, Enterprise and Privacy controls

The starter in `Linqa_Notes_Calendar_Enterprise_Privacy_API_v1` (Express + Knex, plaintext, its own tables) was used as the feature
and API contract, not deployed. The main server already has encrypted notes and calendar tables, organizations and policies,
privacy settings and account deletion, so these screens are built on those instead of a second copy.

## What stores what

| Feature | Where | Server can read it? |
| --- | --- | --- |
| Note (title, body, category, tags, pinned, locked) | `secure_notes_v2.ciphertext` | No. One sealed blob. |
| Event title, location, link, time zone | `calendar_events_v2.title_ciphertext` | No. |
| Event description | `calendar_events_v2.description_ciphertext` | No. |
| Event start and end | `calendar_events_v2.starts_at / ends_at` | Yes. Needed to order and filter events. |
| Organizations, members, policies, audit log | `organizations`, `organization_memberships`, `enterprise_policies`, `organization_audit_events` | Yes. Admin-managed records. |
| Privacy controls | `privacy_settings` | Yes. |

Sealing is XChaCha20-Poly1305 on the phone (`services/workspace-crypto.ts`). The key is derived with HKDF from the account's vault
key, which stays in the phone's secure storage. If the vault key is lost, notes and events can't be opened again; the app reports
them as "can't be opened on this device" and never shows garbled text. Pinned, category, tags and the lock flag are inside the
sealed note, so the server can't see them either.

## API

New (all scoped to the signed-in account; no migration needed):

- `GET /v2/notes`, `PUT /v2/notes/:id`, `DELETE /v2/notes/:id` (create already existed as `POST /v2/notes`)
- `GET /v2/calendar/events?from&to`, `PUT /v2/calendar/events/:id`, `DELETE /v2/calendar/events/:id`
- `GET /v2/enterprise/organizations`, `/:orgId`, `/:orgId/directory`, `/:orgId/policies`, `/:orgId/audit-log` (read-only; active
  membership required; audit log only for OWNER, ADMIN, SECURITY_ADMIN, COMPLIANCE_ADMIN)
- `GET /v1/privacy/settings` (the matching write, `PUT /v1/privacy/settings`, already existed)

Device tokens now also carry `enterprise:read` and `privacy:write`. The existing privacy write required `profile:write`, which no
enrolled device had, so it could not be called from a phone. `privacy:write` is accepted alongside it. Existing sessions pick up
the new scopes when they next enroll or sign in.

## What was deliberately left out

- **Sharing notes and inviting people to events.** Both need a way to give another person the content key. Until that is designed,
  items are owner-only and the screens say so.
- **Starter's contact sync and personalized recommendations toggles.** Nothing in the server reads them, so a switch would do
  nothing. Only settings that are actually enforced are shown.
- **Enterprise edits.** Policy and role changes belong to the admin system (`PUT /v1/organizations/:id/policies/:key` with an
  organization grant). The Business screen is a read-only view.
- **Starter's account-deletion request table.** Deletion and data export already exist with step-up verification; the Privacy
  Center links to them (`/settings/privacy-rights`).

## Tests

- `server/src/tests/modules-routes.test.ts`: auth, scopes, validation, error mapping.
- `server/src/tests/modules.integration.test.ts`: ownership isolation, event window, time constraint, membership and role gates
  (needs a disposable database: `LINQA_WALLET_DISPOSABLE_TEST_DB=1`).
- `clients/mobile/services/workspace.test.mts`, `workspace-service.test.mts`: sealing, model rules, and a fake server that checks
  no readable note or event text leaves the phone.

## Notes and Calendar screens (second pass)

- **Note kinds.** A note, a checklist and a drawing are all sealed notes. The kind is stored server-side as `NOTE`, `CHECKLIST` or
  `DRAWING` (the existing `secure_notes_v2.note_type`); the items and strokes are inside the sealed content. A drawing is saved as
  vector path text in a fixed 1000 x 1000 space, capped at 150,000 characters.
- **Voice Dictation** uses the app's on-device recogniser (`services/dictation.ts`) and is disabled on phones without it.
- **Attach File** saves the file encrypted to LinqaVault (`saveToVault`, 25 MB limit) and stores only the vault link and file name
  inside the sealed note.
- **Event colour** is stored inside the sealed event. **Reminders** are local notifications scheduled 15 minutes before the start;
  the notification says only "Open Linqa to see details" and never includes the title or place. The set of scheduled reminders is the
  only state, and a reminder follows its event if the event moves or is deleted.
- **Movable buttons.** `+ Note` and `+ New Event` are draggable. They snap to the nearer side edge and the spot is remembered per screen
  and account (SecureStore, a convenience only). The Calendar button grows in each time the page becomes active. Screen readers get
  "move to left/right edge" actions instead of a drag.
- **Still not offered:** a "Shared" filter and per-event invites (both need key sharing).
