# Linqa Real Vertical Slice Backend
Date: 2026-08-06

This pack implements one complete backend vertical slice:

1. User exists
2. Device is active
3. Device publishes a signed public key package
4. Sender fetches recipient key package
5. Sender client encrypts message locally
6. Backend stores opaque ciphertext
7. Recipient receives a WebSocket wake-up
8. Recipient leases the envelope
9. Recipient decrypts locally
10. Recipient acknowledges delivery
11. Backend marks the envelope acknowledged

The server never receives plaintext message content or private keys.

## Included

- PostgreSQL 18
- Fastify 5
- JWT device-bound authentication
- Device registry
- Signed key-package storage
- Durable message relay
- Idempotent client message IDs
- Delivery leasing
- Delivery acknowledgement
- WebSocket wake-up
- Rate limiting
- Structured logging
- Health/readiness endpoints
- Docker Compose
- SQL migrations
- Vitest integration tests
- Seed and demo-token scripts
- Windows port override notes

## Local ports

Shipped defaults:
- API: 8080
- PostgreSQL: 5432

Optional local overrides:
- LINQA_API_PORT=8088
- LINQA_DATABASE_PORT=55432

## Production readiness

This slice is a standalone proof of the encrypted-message-relay path — it is not
the full `server/` application and is not meant to be deployed as-is. The backend
deliberately does not decrypt messages or receive private keys. Before production
use, the development JWT setup should be replaced with OIDC/JWKS, key-package
signatures must be validated server-side, and WebSocket notifications should use
Redis or another pub/sub layer when running multiple server instances. See
`RUN_GUIDE.txt` item 12 for the full pre-production checklist.
