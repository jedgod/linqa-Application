# v2.0 — Repo-native integration

Implement after v1.0. This version normalizes the cryptographic contract to `P256_SHA256`, introduces Linqa platform adapters, and requires an authenticated user + installation/device context before enrollment or challenge creation.

Required adapters:
- authenticated principal/session → `{userId, installationId, deviceId, sessionId, authTime}`
- trusted device lookup
- risk engine
- audit/outbox publisher

Enrollment must require an already authenticated, trusted installation and must never accept a face image.
