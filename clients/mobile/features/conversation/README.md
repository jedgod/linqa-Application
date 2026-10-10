# Linqa conversation features

Adapted from the supplied feature pack for the live Expo SDK 57 / React Native 0.86 client.

The conversation page connects `useProductionFeatures` to the existing secure messaging gate, encrypted transport, retained outbox, media relay, preferences, and native capture previews. It includes documents and edited versions, polls and RSVPs, calendar/reminders, location and contact cards, AI image composition, WebRTC calls, Android screen sharing, and a shared whiteboard.

`attachments/production-adapter.ts` implements authenticated file cryptography and the existing blob API. Files are buffered and limited to 25 MB. Private opened files are wiped on lock, background, and leaving the chat. Export requires an explicit action.

AI images require backend provider configuration and explicit consent. Live features require a reachable TURN service with short-lived credentials. Missing services fail closed. External iOS screen sharing remains disabled pending a Broadcast Upload Extension.

Native dependencies require runtime 0.3.0 and a new native binary. The implementation and verification record, provider contract, limitations, and release gates are in [chat-features-upgrade.md](../../../../docs/reference/implementation-notes/chat-features-upgrade.md).

The supplied pure logic tests are in `__tests__`. Additional security, transport, and call-lifecycle tests are in the repository's `tests` directory. Filesystem and permission mocks are isolated in `server/feature-tests`, run with `server/vitest.chat-features.config.ts`; those checks do not replace real-device validation.
