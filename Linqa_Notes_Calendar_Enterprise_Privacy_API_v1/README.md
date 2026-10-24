# Linqa mobile modules API

Self-contained API starter for Notes, Calendar, Enterprise, and Privacy Center. Knex migrations support SQLite for local development and PostgreSQL for deployment.

## Start

1. Use Node.js 20 or newer.
2. Copy .env.example to .env and load it using your environment manager.
3. Run npm install.
4. Run npm run migrate.
5. Run npm start. Default port is 6055.

For SQLite, use DB_CLIENT=sqlite3 and SQLITE_FILE=./linqa.sqlite. For PostgreSQL, use DB_CLIENT=pg and DATABASE_URL. Never commit production credentials.

## Authentication

Every /api/v1 route requires req.user.id or req.user.sub. Mount Linqa's existing verified JWT/session middleware before the route guard in src/server.js. The starter does not decode bearer tokens itself. Do not accept account IDs from request bodies. Adapt getUserId only if the existing auth middleware uses another trusted principal shape.

## API surface

| Screen | Methods and routes |
| --- | --- |
| Notes | GET/POST /api/v1/notes; PATCH/DELETE /api/v1/notes/:noteId |
| Calendar | GET/POST /api/v1/calendar/events; PATCH/DELETE /api/v1/calendar/events/:eventId |
| Enterprise | GET /api/v1/enterprise/organizations; GET /:orgId; GET /:orgId/directory; GET /:orgId/policies; PATCH /:orgId/policies/:policyId; GET /:orgId/audit-log |
| Privacy | GET/PATCH /api/v1/privacy/preferences; GET /api/v1/privacy/export; POST /api/v1/privacy/deletion-requests; GET /api/v1/privacy/deletion-requests/latest |

Organization endpoints enforce active membership. Policy edits and audit-log reads require owner/admin. Notes, events, preferences, export, and deletion requests are scoped to the signed-in account.

## Mobile wiring

The TypeScript client adapter is at mobile/LinqaModulesApi.ts. Set a common API base URL, such as https://api.example.com/api/v1, and provide the existing secure session-token getter. Do not store bearer tokens in AsyncStorage.

- Notes list/create/edit/pin/lock/delete map to /notes. The starter returns at most 200 notes; add cursor pagination for larger accounts.
- Calendar views and create/edit/delete map to /calendar/events. Store timestamps in UTC and include the IANA timeZone. Invitations, push reminders, conferencing, and recurrence expansion need workers/providers.
- Enterprise tiles map to organization, directory, policies, and audit routes. SSO, SCIM provisioning, legal holds, compliance attestations, data residency enforcement, support, and Admin Console need integrations. Show actual configured status in the UI.
- Privacy toggles map to preferences. Download My Data maps to export. Delete Account creates a deletion request.

## Production integration points

The migration creates these module tables only. Provision organization and membership records from Linqa's trusted identity/admin system. Never let mobile clients assign roles.

The locked field is a UI control only; encrypt locked-note content on the client or use an approved server key-management design. The account deletion route records a request but does not delete an account; connect it to re-authentication, legal-retention review, notices, and an account-lifecycle worker. The export contains only these modules' records; combine it with exports from the other Linqa services before calling it a complete account export.

Use HTTPS, least-privilege database credentials, backups, migration review, rate limits, and managed secrets in deployment.
