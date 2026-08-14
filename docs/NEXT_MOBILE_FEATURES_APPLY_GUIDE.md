# Linqa Next Mobile Features Addition — Apply Guide

1. Apply migration `011_next_mobile_features.sql`.

2. Register `registerNextMobileFeatureRoutes()`.

3. Add scopes:
   `message-requests:read`
   `message-requests:write`
   `status:react`
   `status:reply`
   `devices:alerts:read`
   `devices:alerts:write`
   `storage:read`

4. Mount:
   `app/message-requests.tsx`
   `app/status/[statusId].tsx`
   `app/(tabs)/media.tsx`
   `app/privacy-center.tsx`
   `app/settings/notifications.tsx`
   `app/settings/accessibility.tsx`
   `app/settings/storage.tsx`
   `app/settings/ai-privacy.tsx`

5. Add `LinkedDeviceAlertCard` to the Home or Privacy Center when an unacknowledged alert exists.

6. Decrypt message-request previews and status content only in the secure core.

7. Do not generate read receipts while previewing a request.

8. Wire status replies as encrypted direct messages.

9. Persist notification, accessibility, storage, and AI preferences through the existing settings API.

10. Keep all protection labels tied to live runtime state.

Status in this repo: step 1's migration was renumbered
`012_next_mobile_features.sql` (`010` and `011` were already taken — see
`docs/MOBILE_FEATURES_APPLY_GUIDE.md`). Step 2 is applied
(`registerNextMobileFeatureRoutes` registered from `bootstrap/register-all.ts`).
Step 3 needs no separate registration, same reasoning as the companion
pack. Step 4 is applied — all eight files are present under
`clients/mobile/app/`, reachable via Expo Router's file-based routing from
the root `Stack` in `app/_layout.tsx`. Step 5 is **not done**:
`LinkedDeviceAlertCard` is supplied and typechecks, but nothing renders it —
there is no Home screen in this client (see
`docs/MOBILE_FEATURES_APPLY_GUIDE.md`) and `app/privacy-center.tsx` was
applied exactly as supplied, which does not include this card. Step 6 is
not enforceable today: no secure core is wired into this client at all
(`FailClosedAccessTokenProvider` is the only "session" implementation, and
there is no `SecureCoreBridge`-equivalent for this client yet), so nothing
currently decrypts anything, in the core or otherwise — message-request
previews are hard-coded to the literal string `"Encrypted message request"`
server-side rather than actually decrypted anywhere. Step 7 holds by
construction: `GET /v1/message-requests` only reads `message_requests`,
it never touches `client_message_state`/read-receipt tables. Step 8 is
**not done**: `POST /v1/status/:statusId/replies` stores the reply
ciphertext in its own `status_replies` table, not as a direct-message
envelope through `routes/relay.ts` — replying to a status does not
currently produce a real conversation message. Step 9 is **not done**: the
four new settings screens are local `useState` only: switching a toggle is
not persisted anywhere, server-side or otherwise (see
`docs/production-checklist.md`). Step 10 is not done — none of these
screens read from any runtime-capability layer; see
`docs/GAP_CLOSURE_APPLY_GUIDE.md`'s `LiveCapabilityGuard` (a web-only
component; no mobile equivalent exists).
