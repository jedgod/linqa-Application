# Linqa mobile

## Start over Wi-Fi

Keep the computer and phone on the same Wi-Fi network. Connect and authorize the
phone over USB for initial configuration, then double-click `launch-linqa-wifi.cmd`
in the repository root, or run `npm run launch:wifi` here. Authorized wireless ADB
also works. Install the native Android debug build first; Expo Go does not include
Linqa's custom native modules.

The launcher detects the Wi-Fi IPv4 address, starts a LAN API and Metro, checks
both endpoints from the phone, builds the Android bundle, and sets the phone's
bundle location before opening Linqa. Disconnect USB after the launcher succeeds.
Metro normally uses port 8084 to avoid reusing a USB bundle with a localhost API
URL. Logs are under `.runtime/mobile-launch/wifi-*.log`.

After initial setup, the same launcher works with USB disconnected: it starts
the Wi-Fi services, then you open Linqa on the phone yourself. Use
`node scripts/start-mobile-wifi.mjs --serve` from the repository root to start
only the services even when an ADB device is connected. Keep both devices on
the same Wi-Fi and leave the computer/server processes running.

Set `LINQA_WIFI_HOST` to select a LAN IPv4 address, `LINQA_WIFI_METRO_PORT` to choose
a Metro port, or `ANDROID_SERIAL` when multiple devices are connected. If the Wi-Fi
IP changes, stop the Wi-Fi Metro process recorded in
`.runtime/mobile-launch/wifi-state.json` and launch again. App/account data is
preserved. The phone's endpoint checks report when Windows Firewall or Wi-Fi
isolation prevents access.

The Expo / React Native client is installed as **com.linqa.mobile**. The Kotlin client in ../android is a separate application, **com.linqa.app**. This USB workflow launches the Expo client.

## Start on a USB-connected Android phone

On Windows you can also double-click `launch-linqa.cmd` in the repository root. The API started by the launcher watches its source files and reloads after edits. PostgreSQL must remain running, and USB forwarding is restored each time the launcher runs.

From this directory, run `npm run launch:usb`. From the repository root, run `node scripts/start-mobile-usb.mjs`.

Prerequisites: Node 22.13+, installed dependencies in server and clients/mobile, configured server/.env, a running PostgreSQL instance, Android platform tools, and the mobile app installed on a phone with USB debugging authorized. The launcher uses ANDROID_HOME, ANDROID_SDK_ROOT, or the Windows default Android SDK location. Set ANDROID_SERIAL when multiple devices are connected.

The launcher:

- Checks the connected device and installed application.
- Reuses a healthy Linqa API or starts it on computer port 8088 (8089 if needed).
- Leaves Apache or other services on computer port 8080 running.
- Starts this project's Metro server on port 8081 with IPv4 support.
- Sets the bundle's API URL to http://127.0.0.1:8080.
- Forwards phone ports 8080 and 8088 to the API, and phone ports 8081 and 8083 to Metro on computer port 8081.
- Restarts Linqa to load its current bundle; stored app data is preserved.

Keep USB connected. Run the launcher again after a phone restart or reconnection. Logs and process IDs are stored under .runtime/mobile-launch/ at the repository root.

If the debug app still loads an old embedded bundle, open its React Native developer menu, choose **Change Bundle Location**, enter localhost:8081, apply it, and choose **Reload**. The address 10.0.2.2 is the Android emulator's host alias, not the address for this physical-phone USB setup.

## Dependencies and native builds

Use `npm ci` to install locked dependencies and `npm run typecheck` to check TypeScript. Use `npm run android` to build/install the Android client with a JDK compatible with the checked-in Android Gradle plugin and an installed Android SDK. Installing a new native dependency requires rebuilding and reinstalling the APK, not just restarting Metro.

react-native-worklets is pinned to 0.10.3 and react-native-reanimated to 4.5.1. These satisfy this Expo installation's compatibility ranges and prevent optional peers from drifting to Worklets 0.12.x. react-refresh is a direct development dependency required by Expo's Babel preset. Keep native and JavaScript dependency versions aligned.

After changing dependencies, restart Metro before running the USB launcher again. The launcher rejects reuse when its saved dependency-lock signature has changed.

## Startup behavior

The root screen loads the local account registry, then routes to the welcome screen or the onboarding resolver. Account session refresh is deduplicated per user. Temporary connection/server errors retain stored credentials and offer a retry; an invalid refresh token requires sign-in again. Startup network requests time out after 15 seconds.

The app contains Home, Chats, Calls, Media, onboarding, account management, and other feature screens. Successful startup does not establish that every feature or production integration is complete. See module documentation and release/certification evidence for those separate requirements.

## Verification

From the repository root, run `node --import ./server/node_modules/tsx/dist/loader.mjs --test tests/mobile-startup.test.ts`.

These regressions cover temporary outages, credential retention, token rotation, concurrent refresh, retry, onboarding authentication, USB device selection, and API service identification.

Reference designs, implementation notebooks, and historical assessments are indexed in [docs/reference](../../docs/reference/README.md). Runtime screenshots and logs belong in ignored .runtime/, not beside source files.
