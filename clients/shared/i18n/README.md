# Linqa interface languages

The mobile and web clients use this catalog through i18next/react-i18next.
Supported app locales: English, French, European Portuguese (`pt-PT`),
Simplified Chinese (`zh-CN`), Japanese, Hindi for India (`hi-IN`), and
European Spanish (`es-ES`). India has many languages; this implementation uses Hindi.

The app language is a device preference, independent of CountryLinqa discovery
languages, verified country, account identity, and message content. Mobile saves
it in SecureStore (browser storage on Expo web); web uses browser storage.
System mode follows the device language, with English for unsupported locales.
Portuguese and Spanish device variants select the available European catalog.
Traditional Chinese locales fall back to English because this catalog contains
only Simplified Chinese. Language changes preserve mounted screen state.

This is the first migration: welcome, country detection, primary navigation,
settings overview, browser device linking/settings, and common chat controls.
Other screens and less common states still contain English. Native permission
dialogs, security/legal copy, remaining onboarding flows, financial flows, and
full RTL support need separate localization work and review. These translations
should receive native-speaker review before release.

Add complete phrases to every catalog. Translate at render time, including
accessibility labels. Use i18next count keys (`_one`, `_other`) for plurals; never
concatenate translated sentence fragments. Keep route keys, protocol enums,
user messages and decision logic independent of translated labels. Format
presentation values with the selected locale; keep stored numeric values intact.

Mobile needs a new native build for expo-localization and supported-locale config.
The Metro configuration watches the shared directory, and Vite allows the
clients directory so the same resources work in development and builds.
