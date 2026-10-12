# Linqa calls: setup

Everything for voice and video calls, items 1 to 8. Server: NestJS + Prisma + JWT. App: Expo with a dev client.

```
server/            NestJS calls module + Linqa adapters (items 2, 3, 8 push)
coturn/            Relay server (item 4)
mobile/
  src/calls/       Engine, UI, call encryption (item 1), setup (item 5), OS call wiring (item 8)
  modules/linqa-call-native/   Native module: blur (7), PushKit + CallKit (8), Android ring + call service (8), screen-share switch (6)
  ios-extension/   iOS screen-share extension (item 6)
  plugins/         Expo config plugin (items 5, 6)
```

What was checked here: server type-check and 20 tests; app type-check and 20 tests (including real X25519 + ML-KEM-768 + XChaCha20 + Ed25519 crypto); `expo prebuild` on Expo SDK 57 (target, plists, entitlements, re-run safety); Expo autolinking on iOS and Android; a full Metro bundle for iOS and Android.
Not checked: compiling the Swift, Objective-C and Kotlin (needs Xcode and the Android SDK), and real calls on devices.

---

## 1. Call encryption (linqa-core)

There's no MLS anywhere. Each call gets a random 32-byte key:

- **Delivery:** for every device of everyone you call, the key is sealed with linqa-core (X25519 + ML-KEM-768, XChaCha20-Poly1305) and signed with your device's Ed25519 key. The server forwards these sealed keys and can't open them. A device without one is not rung.
- **Signaling:** each message is XChaCha20-Poly1305 under the call key and signed by the sending device. Receivers check the signature against the key directory, so nobody in the call can pose as someone else. Replays are rejected.
- **Media:** DTLS-SRTP. The DTLS fingerprints travel inside the signed, encrypted signaling.
- **Security code:** 12 digits derived from the call key, shown in Call info.

What you connect:

1. **`mobile/src/calls/setup/linqaCoreAdapter.ts`:** point `sealToDevice`, `openSealed` and `signWithIdentity` at the matching linqa-core functions. Private keys stay in Rust.
   If linqa-core doesn't expose those yet, `crypto/jsCoreBinding.ts` implements the same scheme in JS, but it needs the device's private keys in JS memory.
2. **`mobile/src/calls/crypto/httpKeyDirectory.ts`:** set `path` to the endpoint where linqa-core publishes device public keys. It expects base64 `x25519`, `mlkem768` and `ed25519` per device.
3. Make `import 'react-native-get-random-values'` the first import of the app.

## 2. Server adapters

```ts
// app.module.ts
import { CallsModule } from './calls/calls.module';

@Module({
  imports: [
    CallsModule.forLinqa({ imports: [PrismaModule, AuthModule], prisma: PrismaService }),
  ],
})
export class AppModule {}
```

- **Login:** the same JWT as the rest of the API (`sub` = user id). The app sends its device id next to it, and the server checks that the device belongs to that user and isn't revoked.
- **Conversations:** must be in the chat to call it; blocks in either direction stop calls; Add person needs a shared chat.
- The Prisma model names these use are listed at the top of `server/src/calls/adapters/calls-prisma.ts`: `ConversationMember`, `Conversation.members`, `Block`, `Device`. Rename there if yours differ.
- `npm i @nestjs/jwt @nestjs/websockets @nestjs/platform-socket.io socket.io` if they aren't installed yet.
- Copy `server/.env.calls.example` into your `.env`.

## 3. Reports

Add the two models in `server/prisma/calls.prisma` to `schema.prisma`, then:

```
npx prisma migrate dev --name calls
```

## 4. Relay server (coturn)

On a small VM with a public IP:

```
cd coturn
cp .env.example .env              # TURN_SECRET must equal the API's TURN_SECRET
docker compose run --rm certbot   # TLS certificate for turn.linqa.app
docker compose up -d coturn
```

Open 3478 udp/tcp, 5349 tcp, and 49160–49200 udp. Call info shows "Relayed" when a call uses it.

## 5. App wiring

1. Copy `mobile/src/calls`, `mobile/modules`, `mobile/ios-extension` and `mobile/plugins` into the app.
2. Install the libraries:
   `npx expo install react-native-webrtc react-native-callkeep react-native-incall-manager react-native-svg react-native-vector-icons react-native-get-random-values socket.io-client expo-build-properties`
   `npm i @noble/ciphers @noble/curves @noble/hashes @noble/post-quantum`
3. Merge `mobile/app.config.example.ts` into your app config (the plugin, your Apple team id, `googleServicesFile`).
4. Wrap the signed-in part of the app:

```tsx
<LinqaCallsRoot
  session={{ apiBaseUrl, getToken, userId, deviceId, deviceName, platform }}
  core={linqaCoreBinding(LinqaCore)}
  people={{ displayName, addableContacts, block }}
>
  <Stack />
</LinqaCallsRoot>
```

5. Add `<CallButtons conversationId={chat.id} memberUserIds={chat.memberIds} />` to the chat header.
6. Rebuild the dev client: `npx expo prebuild --clean && eas build --profile development`. Expo Go can't run any of this.

Permissions: camera and mic text is added by the plugin and asked for on first use. Android notification permission is requested on start.

## 6. Screen share

- **iOS:** the plugin adds the `LinqaScreenShare` extension and an App Group (`group.<bundle id>`). In the Apple Developer portal, enable App Groups on both the app id and `<bundle id>.LinqaScreenShare`. EAS creates both profiles because the plugin registers the extension. After the user confirms Share, iOS shows its own Start Broadcast sheet. That's an Apple requirement and can't be skipped.
- **Android:** turned on in the native module (react-native-webrtc's own capture service). Android asks for consent each time.

## 7. Background blur

Nothing to wire. The native module registers the effect at launch. It needs iOS 15+ and Android 7+, and the item is greyed out otherwise. On Android, video is capped at 640px on the long edge while blur is on.

## 8. Ringing when the app is closed

- **iOS:** create an APNs key (Apple Developer > Keys) and set `APNS_*` in the API env. Background modes and the push entitlement are added by the plugin. Pushes are reported to CallKit natively, so calls ring even when the app is killed. The caller's name fills in once the app starts, because pushes carry no names.
- **Android:** add an Android app in Firebase, put `google-services.json` in the project root, and set `FCM_SERVICE_ACCOUNT_JSON` in the API env. Incoming calls show as a full-screen call notification with Answer and Decline. During a call, an ongoing notification with End keeps it alive in the background.
- If the app already uses `@react-native-firebase/messaging`, only one Firebase receiver gets messages. Forward the `call-ring` and `call-cancel` types to `IncomingCallNotifier` from that one.

## Test plan before release

1. Two phones on the same Wi-Fi: voice, video, each More item.
2. One phone on cellular: Call info should show Direct or Relayed, and the call should still connect.
3. Kill the app on each platform and call it: it rings, answer works, the name appears.
4. Screen share on iOS and on Android 14+.
5. Blur on an older phone: watch heat and frame rate.
6. Compare security codes on both phones.
