# Linqa on a computer: link by QR code (2026-10-11)

A computer (Linqa Web) is linked to an account by scanning a QR code with the phone, like WhatsApp Web. The computer is a real device of
the account with its own keys; the phone shares nothing but a one-time approval.

## How it works

1. **Computer** (`clients/web/src/auth/LinkWithPhone.tsx`): `POST /v1/device-links` returns a link id and a one-time secret (5 minutes).
   It shows `linqa://link?id=<id>&s=<secret>` as a QR code and polls `POST /v1/device-links/:id/status`.
2. **Phone** (`clients/mobile/app/linked-devices.tsx`, under Settings > Linked devices): scans the code, calls `.../preview` to show
   the computer's name, and the person approves (`.../approve`) or declines (`.../deny`). Needs an enrolled device with `devices:write`.
3. **Computer**: sees `APPROVED`, calls `.../claim` once, and receives a short-lived enrollment session limited to
   `profile:read` and `devices:read`. It then registers its own device keys through the existing device-enrollment flow
   (`/v1/device-enrollment/*`) and publishes its key package.
4. From then on the phone, and other people's devices, seal each message for the computer too (messages are sealed once per device).

Server: `server/src/device-links/` (service, routes), migration `066_device_links.sql`. Only a hash of the secret is stored. Every
step needs the secret, so a wrong secret looks like a missing link. A claim works once, even for simultaneous claims (tested).
`GET /v1/devices` lists the account's devices and `POST /v1/devices/:id/unlink` removes one (revokes the device and its sessions and
drops its connection). The device you are using cannot be unlinked.

## What the computer does

`clients/web/src/chat/`: chat list and conversations from the real server, messages opened and sent with the computer's own keys
(`secureMessaging.ts` is the phone's `SecureCoreMessaging` on the same wire format, so each side opens the other's messages),
a saved session that survives reloads (`linkedSession.ts`: the refresh token is sealed with a non-exportable browser key), and
automatic token refresh. The core's WebAssembly build gained `linqa_verify_key_package` (`core/src/wasm.rs`); the rebuilt files are in
`clients/web/public/linqa-core/`.

Verified: the browser linked and enrolled; a message typed on the computer opened on the phone; a message typed on the phone opened
on the computer; the computer stayed linked after a reload; unlinking removed it. Server tests (`device-links.integration.test.ts`,
real PostgreSQL), web tests (`secureMessaging.test.ts`, two real cores plus a linked computer).

## Limits

- **History**: messages are sealed per device, so a computer sees only messages sent after it was linked. Older ones show as
  "Sent before this computer was linked". Bringing history over needs an encrypted transfer from the phone (not built).
- **Text only**: photos, voice, video, polls and other typed messages show as a label; open them on the phone. Group chats are read-only.
- **Updates by polling** every few seconds, not live push.
- **Calls** are not available on the computer.
- A device list is capped at 8 devices per person by the sealing code.
- The refresh token lives in the browser's storage (sealed). Anyone who can run scripts in the page could use it, so serve the web app
  with a strict content-security policy before using it beyond development.
- The web dev server (`vite`) cannot serve the core's script from `/public`; use `vite build` and `vite preview` (see below).

## Running it locally

```
cd clients/web
VITE_LINQA_API_URL=http://127.0.0.1:8088 npx vite build
npx vite preview --port 5173 --host 127.0.0.1
```

Open http://127.0.0.1:5173/ (the API's `CORS_ORIGINS` already allows port 5173).
