# Linqa Mobile Client

Expo Router (React Native) client for Linqa.

## Status

**New this pass — UI shell, not yet connected to anything real.** No
Expo/React Native project existed in this repo before the "New Mobile
Features" and "Next Mobile Features Addition" packs were applied
(`clients/android`/`clients/ios` are separate native Kotlin/Swift clients;
this is a third, distinct mobile stack). Verified in this environment:
`npm install` (923 packages), `npx tsc --noEmit` (clean, zero errors),
`npx expo-doctor` (17/17 checks pass after adding the peer dependencies it
flagged — `expo-font`, `expo-constants`, `expo-linking`, `expo-asset` — and
running `expo install --fix` to align versions with the installed Expo SDK),
`npx expo export --platform android` (a real Metro bundle of the full app,
989 modules, no resolution/syntax errors), and — correcting an earlier,
wrong claim in this file — **a real native debug build was produced,
installed, and launched** on a physical connected Android device (`npx expo
run:android`, JDK 21, `BUILD SUCCESSFUL in 11m 55s`; confirmed via
`adb shell dumpsys activity` showing `com.linqa.mobile/.MainActivity` as the
foregrounded activity). A real Android SDK, NDK, and JDKs *are* present in
this environment — the earlier "no Android SDK/Xcode" claim in this file
was inaccurate and just wasn't checked at the time.

That said, **the app was uninstalled from the device immediately after
confirming the launch**, at the user's direction: the same physical device
already has the real native Linqa app installed (`com.linqa.app`, from
`clients/android/`), and running a second, unrelated "Linqa" app
(`com.linqa.mobile`) alongside it on the same device was confusing rather
than useful. The code remains in this repo and is known-buildable; it is
just not installed anywhere right now. Two build notes worth keeping if
this is rebuilt later: (1) `app.json`'s `newArchEnabled` had to be set to
`false` — with it `true`, the New Architecture's CMake/ninja C++ build for
`react-native-screens`/`react-native-safe-area-context` produces object-file
paths that exceed Windows' 260-character `MAX_PATH` under this repo's
already-long `OneDrive - Bowie State\Desktop\linqa\clients\mobile\...`
path; (2) Gradle needs `JAVA_HOME` pointed at a JDK 11+ (JDK 21 was used
here) — the system default `JAVA_HOME` in this environment is Java 8, which
fails immediately with an unrelated-looking dependency resolution error.

- Real, reachable screens: Calls (history + filters + search + Quick
  Create), Media (gallery with type filters), global Search, Message
  Requests (accept/decline/block/report), Status viewer (progress bar,
  reactions, reply), Privacy Center (score, devices, sessions, blocked
  users), and four Settings screens (Notifications, Accessibility, Storage,
  AI privacy)
- All data-fetching screens (Calls, Media, Message Requests, Privacy
  Center) call the real `server/` API — no mock data layer exists in this
  client
- `services/session.ts`'s `FailClosedAccessTokenProvider` is the only
  session implementation — every authenticated call fails closed with an
  explicit error until a real secure token store is built (see
  `auth-flow.ts`'s `SecureTokenStore` interface for the refresh-token shape
  a real implementation should target)
- The four Settings screens are local `useState` only — no preference
  persists past the current screen session
- `LinkedDeviceAlertCard` is supplied and typechecks but is not mounted
  anywhere (no Home screen exists in this client to host it)
- No core binding: there is no Expo/React-Native equivalent of the web
  client's `SecureCoreBridge` — nothing in this client can encrypt, decrypt,
  or verify anything cryptographic yet

See `docs/MOBILE_FEATURES_APPLY_GUIDE.md` and
`docs/NEXT_MOBILE_FEATURES_APPLY_GUIDE.md` for the detailed, item-by-item
status of what each pack's apply guide asked for.

## Structure

```
mobile/
├── app/                    # Expo Router file-based routes
│   ├── _layout.tsx           # Root Stack
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Tab navigator (Calls, Media only — see below)
│   │   ├── calls.tsx
│   │   └── media.tsx
│   ├── search.tsx
│   ├── message-requests.tsx
│   ├── privacy-center.tsx
│   ├── status/[statusId].tsx
│   └── settings/
│       ├── notifications.tsx
│       ├── accessibility.tsx
│       ├── storage.tsx
│       └── ai-privacy.tsx
├── components/
│   ├── QuickCreateSheet.tsx
│   └── LinkedDeviceAlertCard.tsx  # not mounted anywhere yet
├── services/
│   ├── calls.service.ts, media.service.ts,
│   │   message-request.service.ts, privacy-center.service.ts
│   └── session.ts            # FailClosedAccessTokenProvider
├── auth-flow.ts             # pre-existing, standalone (MobileAuthFlow)
├── SecureKeyStore.ts         # pre-existing, standalone (FailClosedSecureKeyStore)
├── app.json, babel.config.js, tsconfig.json
└── package.json
```

No Chats/Home tab exists — neither mobile feature pack supplied one, so
this scaffold intentionally does not fabricate a conversation list to match
`clients/web`'s mock UI. The tab bar currently has exactly the two tabs the
packs provided content for.

## Current Blockers

- No secure session/token store (real device-bound token storage)
- No Rust core binding (no WASM/UniFFI-equivalent for Expo)
- Not currently installed anywhere (see above) — an Android build environment
  and a physical test device are both available in this environment when
  needed again
- No Home/Chats screen — nothing in either applied pack supplied one
- No iOS build was attempted (would need a macOS/Xcode environment this
  session doesn't have, unlike the Android SDK)

See top-level `docs/` for the shared design, and `server/README.md` for
what each endpoint this client calls actually does server-side.
