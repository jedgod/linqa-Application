# Linqa Clients

- `android/` – Native Android client
- `ios/` – Native iOS client
- `desktop/` – Desktop client (Tauri / native preferred)
- `web/` – Progressive web client (feature-limited for security)
- `mobile/` – Expo Router (React Native) client: Calls, Media, Search, Message Requests, Status viewer, Privacy Center, and Settings screens, all calling the real server API. No secure session store or core binding yet — see `mobile/README.md`.

All clients share the same Rust cryptographic core. None are wired to it yet — see each client's README for status.
