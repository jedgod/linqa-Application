# Linqa Android release build

This does not fix iOS. It builds a release APK so `libexpo-modules-core.so` is not a Debug library loaded next to the packaged React Native binary.

1. Copy `linqa-signing.properties` and `linqa-release.keystore` into the Expo `android/` directory after running `create-keystore.bat`.
2. Add the `signingConfigs` and `buildTypes` block from `signing.gradle` to `android/app/build.gradle` if the release build type still has `debuggable true` or no signing config.
3. Uninstall the current Linqa app from the Galaxy. This keystore will not match the installed app, and local phone data will be lost.
4. From `android/`: `gradlew.bat clean :app:assembleRelease -x lint -x test`
5. Install `android/app/build/outputs/apk/release/app-release.apk`.

Do not use Expo Go for the send test. After the native app stays open, publish encryption keys, then send. Greene still cannot receive until it has a native iOS build.
