# Vendored BlinkCard Android SDK (not committed)

`com.linqa.vendor:blinkcard-legacy:2.12.0` is Microblink's BlinkCard Android SDK, the last release of the 2.x line.
It is a proprietary commercial library, so the `.aar` is **not** stored in this public repository (see `.gitignore`).
The `.pom` next to it is committed so Gradle resolves the artifact from this local Maven folder.

To build the Android app with card scanning, fetch the library once:

```sh
mkdir -p com/linqa/vendor/blinkcard-legacy/2.12.0
curl -L -o com/linqa/vendor/blinkcard-legacy/2.12.0/blinkcard-legacy-2.12.0.aar \
  https://github.com/BlinkCard/blinkcard-android/raw/v2.12.0/LibBlinkCard.aar
sha256sum com/linqa/vendor/blinkcard-legacy/2.12.0/blinkcard-legacy-2.12.0.aar
# expected: 2a129963b1aed08c23423d6fe12de80c3269659dc3cf96e6eb4f5ed0a866e466
```

Run it from this directory. Use of the SDK is subject to Microblink's license terms. Scanning also needs a Microblink
**BlinkCard** license key for application id `com.linqa.mobile`, set as `EXPO_PUBLIC_BLINKCARD_LICENSE_KEY` in
`clients/mobile/.env.local` (never commit it). A key issued for another Microblink product (for example BlinkID) is
rejected by the SDK. Microblink no longer maintains the 2.x line; the current SDK is 3000+ (`com.microblink:blinkcard-ux`).
