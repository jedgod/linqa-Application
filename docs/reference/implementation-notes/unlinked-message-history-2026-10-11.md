# Claude phone changes and unlink history fix

Reviewed the phone header search, Messaging preference, chat action sheets, list rename and group picker wiring. The installed packages initially matched the reported timestamps: LG 16:29:42 and Galaxy 16:21:53 on October 11. Both are packaged release builds, so updating source or reloading the app alone does not install a JavaScript fix.

## Findings and fixes

Devices already retain their enrolled signing public key when unlinked. The failure was that phone and browser message opening searched only the active key-package directory. Removing a browser from that directory correctly prevents new encryption to it, but previously also made its accepted messages unreadable.

The separate `POST /v1/chats/:conversationId/messages/:messageId/sender-key` lookup supplies only the public signing key of an already accepted message. It requires an authenticated active requesting device, messages-read scope, current conversation membership, the exact stored ciphertext and matching sender user/device. Deleted, expired and cleared messages are excluded. A message accepted after the sender's revocation is excluded. No private or encryption key is returned. Rust still verifies the envelope signature and decrypts it; inner conversation/sender checks remain unchanged.

Phone and browser use this lookup only when the active package directory cannot identify a sender. Sealing messages refreshes the active directory, bypassing cached recipient packages; call key lookup still uses the active directory. Both directory responses and historical-key responses prohibit HTTP caching. No revoked device is added to recipient selection. No schema migration or key replacement is needed.

Chat message acceptance now checks and share-locks the sender device row inside its transaction, serializing acceptance against unlink. A still-valid JWT from a revoked device cannot submit a new message. Chat v2, inbox/read receipt and organization routes also reject revoked device-bound tokens.

The group UI previously refreshed its people list after adding someone, but secure messaging relied on a global, potentially stale recipient list. Phone message sealing now fetches current conversation membership directly from the server. Add people waits for its controls refresh and limits selection to available group slots.

The saved Enter-to-send preference now notifies mounted composers. Its settings switch waits for initial loading and serializes saves. The Expo runtime version is explicitly `0.3.0`, matching the existing native resource; the policy form was rejected by the local bare-workflow manifest endpoint.

## Verification

- Disposable PostgreSQL integration run: 59 tests passed across historical verification, chat v2, device linking and chat organization. Includes revoked-token submission, forged/changed ciphertext, revocation cutoff, clear/delete/expiration/membership, public key retention, and active-directory exclusion.
- Production Rust/WASM plus actual phone messaging service: old poll and vote payloads open after sender unlink; an unaccepted message is rejected; new encryption excludes the revoked browser; the revoked browser cannot seal a new message. Existing secure messaging regression tests passed.
- The 11 client regression tests confirm fresh group membership, rejection of mismatched historical sender responses, and bypassing cached recipient keys after unlink.
- Server, mobile and web TypeScript checks and desktop production build passed.
- Galaxy New group picker was opened without creating a group. Real reports, groups and message deletion are not used as destructive test fixtures.

The final signed local Android APK build passed (both ARM architectures). Galaxy installation succeeded at 18:25:18 on October 11. Its affected chat dropped from two unreadable messages to zero; the recovered poll opens in Decisions and shows the recorded vote. The header search opens its input. Report opens its sheet; Clear chat and Delete chat show confirmations. All were cancelled without reporting or deleting real data. LG installation succeeded at 18:34:06 on October 11. Its affected chat also dropped from two unreadable messages to zero after encryption initialization completed; its recovered poll opens in Decisions and shows the recorded vote. Both accounts and chat data were preserved. Local API readiness and both phones' API reverse routes were verified after the final server restart. The build uses the existing Linqa local signing certificate, not the Android debug key; no signing credentials are committed or printed.
