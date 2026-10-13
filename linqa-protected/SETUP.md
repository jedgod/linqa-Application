# Linqa protected photos: setup

Builds on the earlier drawer/profile files (`constants/theme.ts`, `components/ui/Rows.tsx`,
`lib/profileApi.ts`, and the API's `profile/current-user-id.decorator.ts`).

## API (NestJS)

1. Paste `prisma/protected-media.prisma` into `schema.prisma`, then
   `npx prisma migrate dev --name protected_media`.
2. Copy `src/protected-media/` into `src/` and add `ProtectedMediaModule` to `AppModule` imports.
3. `.env`:
   - `AUDIT_SECRET=` at least 32 random characters (`openssl rand -hex 32`). Keep it out of the database
     server; changing it makes old audit logs fail verification.
   - `PROTECTED_MEDIA_DIR=` a private folder or volume that is not served publicly (default `uploads/protected`).
4. Optional: wire push notifications in `MediaEventsService.push()`.
5. Tests: build with `npx tsc`, then `node test/protected-media.scenarios.js`
   (uses an in-memory fake database; 27 scenario checks).

## App (Expo)

1. Install:
   `npx expo install expo-screen-capture expo-crypto expo-file-system expo-image-manipulator expo-image-picker expo-secure-store`
   `npm i @noble/ciphers @scure/base react-native-sse`
2. Copy `modules/screen-recording-detector/` into your project's `modules/` folder
   (Expo autolinks local modules there).
3. `app.json`, Android 13 and older need this for screenshot detection:
   `"android": { "permissions": ["android.permission.READ_MEDIA_IMAGES"] }`
4. Rebuild the dev client (`npx expo run:android` / `npx expo run:ios` or EAS). New native code.
5. Wire into chat:
   - Composer: open `<ProtectedPhotoComposer>`; in `onSent`, send the payload through linqa-core,
     and save `stripSecret(payload)` as your own copy.
   - Incoming: if `isProtectedMediaPayload(content)`, call `receiveProtectedPhoto(content)` and
     save what it returns (no key) in your message store.
   - Rendering: `<ProtectedMediaBubble mediaId mode maxViews windowSeconds expiryStart isMine />`.
   - Once at app root (signed in): `useProtectedMediaEvents(alert => ...)` and show `describeAlert(alert)`.
