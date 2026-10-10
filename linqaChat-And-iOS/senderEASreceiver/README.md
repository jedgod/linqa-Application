# What this solves

`linqa-secure-core` was Android-only, so an iOS binary could not publish keys. `expo-module.config.json` registers the module on Android and iOS. `eas.json` is the cloud build Greene needs. This PC still cannot compile the iPhone app.

Copy this folder to `modules/linqa-secure-core`. Add it to `plugins` or `autolinking` in the Expo app. Apply `device-keys.sql` on PostgreSQL.

Send only through `sendEncrypted`. It throws if the binary has no native module, and it throws if the peer has no row in `device_keys`. Do not add a plaintext fallback.

Android: install the release APK from `linqa-android-release`, sign in, and upload keys.
iOS: from a machine with the Apple account, run `npx eas-cli build --platform ios --profile preview`, install that build on Greene, then upload keys. After both rows exist, send again.
