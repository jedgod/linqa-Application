# Call action pack integration ? 2026-10-10

Source: `linqa-calls_video`.

Adapted the supplied menu and board model/canvas into the existing mobile call overlay and two-party controller. Kept Fastify, the durable PostgreSQL safety-report service, and existing signaling/relay-only policy. The pack?s independent NestJS/socket.io engine and in-memory call store were not installed.

Implemented:
- Voice/video-specific More menus; recording remains available with existing consent.
- Raise/lower hand through the existing DTLS-encrypted peer data channel.
- Shared drawing board with normalized strokes, color/width selection, undo, opener-only clear/close, and one confirmation before opening. No board snapshots accepted from peers. The original caller wins simultaneous board-open requests.
- Call information including elapsed time, connection condition and call reference.
- Call reporting with category and description through `/v1/safety/reports`, no media attachments. Backend checks the reporter?s membership in the referenced call and checks an explicitly reported participant.
- Camera upgrade in a connected voice call using a reserved video transceiver. Late permissions/media cannot resurrect an ended call.
- Android screen capture, explicit confirmation and native consent, sender-track replacement, camera restoration, and complete display-track cleanup on hang-up. iOS capture disabled until a Broadcast Upload Extension exists.

Remaining capabilities are explicitly disabled in the menu: adding participants (requires group media/signaling), device handoff (requires receiving-device confirmation and transactional ownership transfer), background blur (supplied native processors have not been integrated/built). This is a partial integration of the pack, not completion of its full group-call architecture or MLS signaling requirement. Existing signaling remains authenticated base64 JSON; media and peer actions use WebRTC transport encryption.

Validation: controller regressions and new media/action tests, supplied pure menu/board tests, safety service authorization tests and existing call route tests. Live two-phone camera/screen sharing, board interactions, and real report submission have not been exercised. No real calls or reports were initiated automatically.

Verified results: 18 controller tests plus 22 backend/menu/board tests passed (40 total). Mobile `tsc --noEmit` and backend `npm.cmd run build` passed. Metro returned an Android bundle with HTTP 200 and the new action code. A separate Expo export attempt could not write its `.expo/dev/logs/export.log` (EPERM); no standalone release export or new APK was produced for this change. Existing native capture support is reused. Phones were not reinstalled or actively called during this integration.
