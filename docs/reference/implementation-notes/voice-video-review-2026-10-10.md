# Voice and video upgrade review — October 10, 2026

Reviewed the current call pages, CallOverlay, CallController, incoming listener, call service contracts, and the new incoming/details/accept backend routes. The working tree contains other upgrades; they were preserved.

The UI provides distinct voice/video layouts, incoming accept/decline, mute, speaker, camera toggle/flip, connection quality, the peer's verified country, minimization with a return bar, and participant-consented recording. Recording captures local microphone audio and exchanges transcript lines over the WebRTC data channel; it does not capture a mixed recording of both participants' audio.

## Corrections made during review

- Hangup and decline release media without waiting for backend termination. Media arriving after hangup is stopped immediately; late peer callbacks cannot restore the call.
- Permission, call-manager, signaling and recorder continuations check call lifetime. Recorder setup cannot restart recording after termination. Incoming-listener teardown rejects late tokens and catch-up results.
- Signals check call and sender identity; replay state and pending ICE are bounded. Signaling processing is serialized. Connecting and prolonged disconnected calls have cleanup deadlines.
- Restored the existing `RELAY_ONLY` outgoing-call default. The controller previously forced `STANDARD`, and an incoming call could change the next outgoing call's policy. A relay-only connection now reports unavailable when no usable TURN endpoint is returned.
- Video controls now share available width on narrow phones, and video has a visible minimize control. Native video rendering loads only for a live video call.
- Recording consent discloses transcript sharing. Transcript input is bounded; final peer lines remain eligible during the recording stop grace period.
- Unavailable video-upgrade/screen-sharing buttons retain explanatory notices without claiming to be disabled to accessibility services.

## Validation

Ten call-controller regression tests, nine shared live-media regressions, and four new backend authentication/authorization tests passed (23 total). An initial backend test run during native compilation exceeded the default five-second timeout; the direct runner subsequently passed. The final mobile typecheck and backend TypeScript compilation passed.

Android verification targets `armeabi-v7a` for the LG LM-X320 and `arm64-v8a` for the Galaxy SM-A037U. Installation uses `adb install -r` and preserves app data. No calls to real contacts or messages are sent as part of this review. The existing development backend was ready on port 8088.

The dual-architecture debug build passed (`tmp/call-review-android-build.log`). Its 224 MB APK installed successfully on the LG. The LG rendered the upgraded voice-call screen during device use, including the connection-quality indicator, country, controls and recording menu; native peer statistics were also active. This is evidence of rendered UI and an active peer connection, not agent verification of audible two-party audio or recording output.

The Galaxy rejected the combined APK with `INSTALL_FAILED_INSUFFICIENT_STORAGE`. Optional `-PlinqaSplitApks=true` packaging produces separate ARM32/ARM64 test APKs without altering default packaging, to retry the update without deleting device data. The Galaxy retry was held while both devices displayed a call.

## Remaining limits

Switching a voice call into video and screen sharing on these call pages are still unavailable. Device refresh and startup do not prove two-party media, audio routing, camera switching, recording consent/transcription, or recovery on real networks. These need two configured test accounts and a reachable TURN relay. iOS was not built or device-tested. Signaling bodies use base64 JSON through the authenticated server; base64 is not encryption. Call media and the data channel use WebRTC transport encryption, but this review does not certify independent peer identity verification or encrypted signaling.
