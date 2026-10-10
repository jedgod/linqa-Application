# Biometric deployment checks — October 6, 2026

## Completed

- Created a PostgreSQL custom-format backup of the configured local `linqa` database at `.runtime/biometric-deployment/pre-048.backup` before migrating.
- Applied migration `048_biometric_authorization.sql` through the checksum-aware migration runner. Its migration record is clean, all seven biometric tables exist, and the recovery trigger exists.
- Tested the recovery trigger against PostgreSQL inside a rolled-back transaction: `ACCOUNT_RECOVERY_COMPLETED` increased the account security epoch by one. The test left no recovery event or test security state committed.
- Started the updated local API on port 8090; `/health/ready` returns ready. Phone API ports 8080 and 8088 are forwarded to it over USB. Unauthenticated Private Vault listing returns 403.
- Confirmed Expo's generated Android module registry includes `com.linqa.biometric.LinqaBiometricModule`.
- Added the attestation configuration pair to `server/.env.example`. Actual verifier values remain absent; no attestation was accepted or fabricated.

## Native build status

The full arm64 Android debug APK build succeeded on 2026-10-06 (`BUILD SUCCESSFUL`, 392 tasks, 33m 54s). The app now uses `RelWithDebInfo` for its C++ build, matching the React Native release prefab symbols. The short workspace mapping `L:` and runtime init script avoid Windows path-length and Ninja regeneration problems. Kotlin recovered from its incremental-cache root mismatch by compiling without its daemon.

Artifact: `clients/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (66,544,719 bytes). SHA-256: `7a3c9395c276ed494e278a16e145fbd0811614274f02c2863767daa2f1efee23`. Build log: `.runtime/biometric-deployment/android-security-build.log`.

Android refused an in-place update with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The installed `com.linqa.mobile` version 0.1.0 has certificate SHA-256 `fc2f36fd0e3f867a3564b176ac9cfa8a6427be382210bae1195ccebbca79f055`; the rebuilt debug APK has `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. The global developer debug keystore also differs. The installed application and its data were retained. The original matching signing keystore is required for an update that preserves data; its location has been requested. No startup of the rebuilt APK or successful physical biometric flow is claimed.

The patched mobile dependencies and source also compiled successfully in EAS iOS simulator build [94c4853e-09d3-4c33-bc95-36a7a806187e](https://expo.dev/accounts/guardalert/projects/linqa-mobile/builds/94c4853e-09d3-4c33-bc95-36a7a806187e). This is a simulator compilation result, not a signed iPhone build or a Secure Enclave/Face ID runtime result.

## Outstanding prerequisites

- **Verified attestation:** supply an actual verifier service endpoint and its service credential through the appropriate secret/configuration store. Production enrollment remains denied without independently verified platform evidence. An environment template does not configure a verifier.
- **Android biometric tests:** the connected Samsung SM-A037U runs Android 13 and reports zero enrolled fingerprints. The device owner must enroll a fingerprint and interact with the sensor. The local database also has no currently active trusted device/session/installation principal for the full protocol, so sign-in and installation trust must be completed through the normal application flows.
- **iOS testing:** Expo EAS simulator build `d1adf32a-9219-4b26-9ad6-2b6d32675d5d` finished successfully on 2026-10-06. [Build evidence](https://expo.dev/accounts/guardalert/projects/linqa-mobile/builds/d1adf32a-9219-4b26-9ad6-2b6d32675d5d). This verifies iOS compilation, including the native module, for the submitted snapshot. It does not verify Face ID, Secure Enclave or physical-device attestation. An identified iPhone and signed device build are still required.

## Required device results before release

Record real results for successful enrollment; denied/canceled prompts; Private Vault unlock; clearing private metadata on background/navigation/account switch; expiry and revocation; fingerprint enrollment-change invalidation; transfer confirmation using a one-time biometric grant; rejection after quote/recipient/funding changes; and recovery invalidation. Run the corresponding iOS Face ID/Touch ID checks. Use a trusted sandbox account and payment environment for transfer tests. Startup, compilation and simulated tests do not establish these results.
