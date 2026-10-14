# Mobile photo review — October 13, 2026

Reviewed the checked-in implementation and `thingsdone.txt`. “Portal” was clarified to mean hamburger > profile update.

## Changes

- Welcome artwork rotates counterclockwise once every three minutes; reduced-motion settings disable it.
- Avatar uploads normalize the picked image to a 768-pixel-wide JPEG and read its bytes with Expo FileSystem, replacing `fetch(localUri)`. Temporary converted files are removed.
- Picker failures now produce an error, and the picker/upload remains disabled while busy.
- Failed avatar images retry after the URL or authorization changes. The drawer avatar opens the profile editor.
- Profile requests that finish after an account switch are discarded.
- Protected viewing awaits native capture blocking before requesting a view. Native failures refuse the photo. Android's full-screen dialog is created after FLAG_SECURE is enabled, so it inherits the flag. Capture blocking remains enabled until viewer cleanup.

## Protection integration found

The production mobile client contains the composer, policies, encrypted upload, protected bubbles, secure-store keys, and viewer. The Fastify server registers protected-media routes and includes migration 073 for media, views, and audit records. Avatar storage is in migration 072.

This is a production adaptation of `linqa-protected`, whose original server reference is NestJS; it is not simply an unused reference directory.

Remaining gaps: `ProtectedContentBubble` copies a secret to SecureStore when rendering, rather than using `receiveProtectedPhoto` to remove the secret during ingestion. `stripSecret` is not wired into the sender's copy. The reference signed-in app-root `useProtectedMediaEvents` hook is not present in the production client. Server enforcement and audit records do not by themselves prove the client notification experience or key lifecycle meets the reference design.

## Verification and limits

- Three avatar route tests passed: raw-byte storage/versioned URL, missing-session rejection, invalid-image rejection.
- Final mobile TypeScript check and Git whitespace check passed.
- The protected-media database suite could not run: the isolated Docker runner received a Docker Desktop HTTP 500 while inspecting the cached PostgreSQL image. No development database was used.
- ADB listed only Galaxy SM-A037U, serial R9TT703HH0Y. LG install completion and Galaxy authentication were not verified. No new APK was built or installed in this review.

## Required device acceptance

1. Install the updated app on both phones and sign in.
2. From hamburger > profile update, choose and save a photo. Verify it in the editor and drawer, restart, and check it persists. Change it again after a failed image load.
3. Send a protected “view once” photo LG → Galaxy. On Galaxy attempt a screenshot while open, close, and attempt to reopen. The screenshot must be blocked/blank and reopening refused.
4. Repeat Galaxy → LG; test recording, app backgrounding, expiry, sender revocation, and sender notifications.
5. Record device OS/build versions and actual screenshot results. Automated tests are not a substitute for these checks.
