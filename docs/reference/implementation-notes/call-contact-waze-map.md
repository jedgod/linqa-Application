# Waze map in call contact Info

The Info tab embeds the official Waze map for coordinates already shared by the other participant in their direct chat. A country-only location cannot supply a map pin. The pin's place/address label is rendered locally; contact names, avatars and chat identifiers are never passed to Waze. Labels containing the contact's name use “Shared location” instead. The map is a fixed destination preview so its local label stays aligned with the shared destination.

Optional Expo configuration:

```dotenv
EXPO_PUBLIC_WAZE_EMBED_URL=https://embed.waze.com/iframe?zoom=14
```

Use a localized path, such as `https://embed.waze.com/fr/iframe?zoom=14`, to configure the language. Zoom ranges from 3 through 17. Only the HTTPS Waze embed origin and iframe paths are accepted. Other query parameters are discarded before shared coordinates and the plain pin are added.

The map uses `react-native-webview` on iOS/Android and an iframe on web. Rebuild the native client after installing this dependency. The map requires internet access; a failed native load offers Retry. It does not request this device's location or claim an old chat location is live. Other call controls and contact tabs are unchanged.

Reference: https://developers.google.com/waze/iframe

Checks: `node --test tests/waze-map.test.mjs` and the mobile TypeScript check. A native device check is still required for map appearance and provider behavior.
