# Request examples

All routes require the signed-in user's session. Authorization headers are omitted here.

## Create a note
POST /api/v1/notes
Content-Type: application/json

{"title":"Roadmap review","body":"Bring draft milestones","category":"Work","tags":["planning"],"pinned":true,"locked":false}

## Create a calendar event
POST /api/v1/calendar/events
Content-Type: application/json

{"title":"Design standup","description":"Product team sync","startAt":"2026-06-10T13:00:00.000Z","endAt":"2026-06-10T13:30:00.000Z","timeZone":"America/New_York","location":"Video meeting","attendees":["teammate@example.com"]}

## Update privacy controls
PATCH /api/v1/privacy/preferences
Content-Type: application/json

{"discoverable":false,"readReceipts":true}

## Request account deletion
POST /api/v1/privacy/deletion-requests
Content-Type: application/json

{"confirmation":"DELETE MY ACCOUNT"}

Deletion is asynchronous and must be completed by Linqa's account-lifecycle workflow.
