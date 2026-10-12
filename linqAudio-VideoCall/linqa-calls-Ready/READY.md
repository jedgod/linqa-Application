# Ready to implement

This pack is the call layer. It is not MLS. Each call uses one sealed 32-byte key.

## Must connect before a real call

1. Point `mobile/src/calls/setup/linqaCoreAdapter.ts` at Rust `seal`, `open`, and `sign`.
   Do not ship `jsCoreBinding.ts` as the production path. It keeps private keys in JS.
2. Point `httpKeyDirectory.ts` at the device key directory (`x25519`, `mlkem768`, `ed25519`).
3. Add Prisma models from `server/prisma/calls.prisma` and run the migration.
4. Register `CallsModule.forLinqa(...)` and copy `.env.calls.example`.
5. Start coturn with the same `TURN_SECRET`.
6. Rebuild the dev client. Expo Go cannot run this.
7. For more than one API instance, use `redis-calls.store.ts` and the socket.io Redis adapter.

## Already in this pack

- Call create, join, decline, leave, add person, switch device.
- Sealed call key, signed signaling, DTLS-SRTP media.
- Report, call info, ICE/TURN credentials.
- More: raise hand, board, blur, flip, switch device, call info, report.
- Video header: SIGNAL, LOCATION (flag + coarse area), End-to-end duration.
- Voice bar: Share screen, with a confirm before it starts.
- iOS screen-share extension, Android/iOS blur processors, CallKit/PushKit stubs.

## Location

`CallPeopleDirectory.location(userId)` returns `{ countryCode, flag, area }`.
Example: `{ countryCode: "US", flag: "🇺🇸", area: "GLENN BURNIE, MD" }`.
Do not send a street address. If missing, the header says "Area unavailable".
