# Linqa calls: setup

Voice and video calls for Linqa. Full-mesh WebRTC (up to 8 devices), signaling encrypted with a per-call MLS group, NestJS backend for routing, TURN credentials, call info and reports.

## What's where

```
server/                         NestJS module (drop into the existing API)
  src/calls/calls.protocol.ts   Shared wire types. Keep identical to mobile/src/calls/protocol.ts
  src/calls/calls.service.ts    Call state: ring, join, decline, leave, add person, switch device
  src/calls/calls.gateway.ts    socket.io gateway (/calls namespace) + presence
  src/calls/calls.controller.ts REST: GET /calls/:id, POST /calls/:id/reports, GET /calls/ice-servers
  src/calls/reports.service.ts  Reports (metadata only)
  src/calls/turn.service.ts     coturn REST credentials
  src/calls/calls.ports.ts      Seams to your auth, conversations and push code
  migrations/001_call_reports.sql
mobile/                         React Native
  src/calls/CallManager.ts      App-wide: socket, incoming rings, incoming device switch
  src/calls/CallEngine.ts       One call: peer connections, media, data channel
  src/calls/moreMenu.ts         What goes in More, and the confirm rules
  src/calls/board.ts            Shared board model
  src/calls/ui/*                Call screen, More sheet, confirms, sheets, board
  native/ios, native/android    Background blur processors
```

## Corrections in this pack

- Video header matches the Keona page: SIGNAL on the left, LOCATION in the middle (country flag and coarse area), name and End-to-end duration on the right.
- Location comes from `CallPeopleDirectory.location(userId)`. Return country code, flag, and area only. Do not send a street address.
- Voice bar matches the Bishop Enchi page: Share screen is on the bar and asks once before it starts. It is not duplicated in voice More.
- Video keeps Share screen in More.
- Call state is still in memory. For more than one API instance, move `CallsStore` to Redis.

1. Copy `server/src/calls` into the API. Install `@nestjs/websockets @nestjs/platform-socket.io socket.io`.
2. Implement the three ports in `calls.ports.ts` with existing code and register:

```ts
CallsModule.forRoot({
  imports: [AuthModule, ConversationsModule, PushModule],
  auth: JwtCallsAuth,                    // verify(token) -> { userId, deviceId, deviceName, platform }
  conversations: ConversationsCallsAdapter, // isMember(), canCall() (blocks, contacts)
  ringNotifier: VoipPushNotifier,        // PushKit / FCM high-priority, ids only
  reportsRepository: SqlReportsRepository,  // backed by migrations/001_call_reports.sql
})
```

3. Environment:

```
STUN_URLS=stun:turn.linqa.app:3478
TURN_URLS=turn:turn.linqa.app:3478?transport=udp,turns:turn.linqa.app:5349?transport=tcp
TURN_SECRET=<same value as coturn static-auth-secret>
TURN_TTL_SECONDS=21600
```

4. coturn (`/etc/turnserver.conf`), minimum:

```
use-auth-secret
static-auth-secret=<TURN_SECRET>
realm=linqa.app
listening-port=3478
tls-listening-port=5349
cert=/etc/letsencrypt/live/turn.linqa.app/fullchain.pem
pkey=/etc/letsencrypt/live/turn.linqa.app/privkey.pem
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

5. Call state is in memory. That works for one API instance. For more than one, put `CallsStore` in Redis and add the socket.io Redis adapter.

Tests: `cd server && npm test` (12 tests: ringing, timeouts, decline, signal relay, add person limits and blocks, device switch and expiry, reconnect grace, duration, reports).

## Mobile

1. Copy `mobile/src/calls` into the app. Install:
   `react-native-webrtc react-native-incall-manager react-native-svg react-native-vector-icons socket.io-client`
2. Implement `CallCrypto` (`ports.ts`) on top of the existing MLS client: create a group per call, add users, add own device, encrypt and decrypt with the authenticated sender, and an epoch-authenticator code for Call info.
3. Wrap the app:

```tsx
const calls = new CallManager(session, mlsCallCrypto);
<CallProvider manager={calls} people={directory}>
  <App />
</CallProvider>

// From a chat header:
calls.startCall(conversationId, 'video', otherMemberIds);
```

Tests: `cd mobile && npm test` (More menu contents and confirm rules, board rules).

### Permissions

- iOS `Info.plist`: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, Background Modes: `audio`, `voip`.
- Android: `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_CAMERA`.

### Share screen (video calls)

- Android 10+: start a foreground service of type `mediaProjection` before `getDisplayMedia()` (react-native-webrtc's screen-share guide). Android 14 will throw without it.
- iOS: add a Broadcast Upload Extension and app group as described in react-native-webrtc's iOS screen-share docs. Without it, `getDisplayMedia()` only captures the app itself. Set `deviceCapabilities.screenShare` to `false` until the extension ships so the item shows as unavailable.

### Background blur

- Android: add `native/android/*.kt` to the app (package `app.linqa.calls`), add `LinqaVideoEffectsPackage()` to `getPackages()`, and in `app/build.gradle`:
  `implementation 'com.google.mlkit:segmentation-selfie:16.0.0-beta6'`
- iOS: add `native/ios/*` to the app target. In the bridging header: `#import "ProcessorProvider.h"`. iOS 15+.
- Blur output on Android is capped at 640px on the long edge while blur is on.

## How the More menu behaves

- Bar, never in More: Mute, Speaker, Video, End.
- Voice: Add person, Raise hand, Switch device, Write on board, Call info, Report.
- Video: Share screen, Raise hand, Add person, Write on board, Flip camera, Blur background, Switch device, Call info, Report.
- Flip camera shows only when the self-view (which has its own flip button) is hidden.
- A voice call where someone turns on their camera switches to the video menu.
- One confirm each before: starting a screen share, opening a board, adding someone (the confirm names them). Stopping a share or viewing a board someone else opened does not ask again.
- Switch device asks on the receiving device ("Take call here?"), not on the sending one.

## Limits to know

- Mesh tops out around 8 people. Past that, move to an SFU with SFrame/MLS media keys.
- Reports carry no audio or video. The server has none to send.
- Background ringing needs PushKit + CallKit (iOS) and ConnectionService or a full-screen notification (Android). `RingNotifier` is the hook; the in-app ring overlay only works while the app is open.
- The native blur code was not compiled here. Build and profile it on a real device before release.
