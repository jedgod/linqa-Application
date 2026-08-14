# Linqa New Mobile Features — Apply Guide

1. Replace the current Calls placeholder with `app/(tabs)/calls.tsx`.
2. Wire the top-right plus button to `QuickCreateSheet`.
3. Add `app/search.tsx` and open it from the search icon.
4. Apply migration `010_mobile_features.sql`.
5. Register `registerMobileFeatureRoutes()`.
6. Add scopes:
   `status:write`
   `calls:schedule`
7. Replace localStorage token access with the existing secure session service.
8. Encrypt status content before `POST /v1/status`.
9. Connect the Calls tab to the existing call creation/signaling services.
10. Keep call security labels runtime-derived, not hard-coded.

Status in this repo: no Expo/React Native mobile client existed before this
pack (`clients/android`/`clients/ios` are native Kotlin/Swift; `clients/web`
is a Vite/React PWA) — only two standalone building-block files
(`clients/mobile/auth-flow.ts`, `SecureKeyStore.ts`) sat waiting for one.
A new Expo Router scaffold was created at `clients/mobile/` to host this
pack. Step 1 is applied there (no prior placeholder existed to replace).
Step 2: `QuickCreateSheet` is wired to a new plus button in the Calls
header — no pre-existing "top-right plus button" existed anywhere to wire
into, since no Home/Chats screen ships with either pack. Step 3 is applied.
Step 4's migration was renumbered `011_mobile_features.sql` — `010` was
already taken by a `mobile-hub.ts`/`010_mobile_hub.sql` addition from a
separate, concurrent change to this repository (see
`server/README.md`'s "Bugs found and fixed" section). Step 5 is applied
(`registerMobileFeatureRoutes` registered from
`server/src/bootstrap/register-all.ts`). Step 6 needs no separate
registration — scopes in this codebase are plain strings checked by
`requireScope()`, and the routes already enforce both. Step 7 is
**not actually possible as stated**: no concrete "secure session service"
exists anywhere in this repo to replace `localStorage` with — replaced the
broken pattern (React Native has no `localStorage` global; the supplied
code always evaluated to `undefined` and always threw) with an explicit,
honestly-fail-closed `FailClosedAccessTokenProvider`
(`clients/mobile/services/session.ts`) instead, matching this repo's
established fail-closed convention. Step 8 (encrypt status content
client-side before POST) is enforced server-side only (min ciphertext
length check) — no client-side encryption path exists since no core
binding is wired to this client yet. Step 9 and 10 are not done — the Calls
tab reads real call history but does not initiate a real call through the
existing signaling stack, and there is no runtime-derived security-label
system in this client (see `docs/production-checklist.md`).
