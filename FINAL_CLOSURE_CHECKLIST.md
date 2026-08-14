# Linqa Final Closure Checklist

Updated: 2026-08-06. Checked items have executable evidence in this repository.

## Runtime and server

- [x] One service container and one route bootstrap register all route groups.
- [x] Final group, network-risk, device-integrity, and expiry routes are registered.
- [x] Duplicate route registration is covered by a Fastify startup test.
- [x] Object storage and push integrations fail closed when absent.
- [ ] All six migrations apply to a clean PostgreSQL instance in release CI.
- [ ] OIDC/JWKS replaces development HS256 authentication.
- [ ] Redis fan-out and monitored background scheduling work across API replicas.

## Core and messaging

- [x] Windows Rust format, Clippy with warnings denied, tests, and release build pass.
- [ ] Rust format, Clippy, tests, and release build pass on all three CI operating systems.
- [ ] WASM and Android/iOS bindings are generated and compile.
- [x] Core source validates signed key packages, enrollment proofs, envelope integrity, and replay.
- [x] Web receive flow acknowledges only successfully decrypted envelopes.
- [x] LIVE selects the fail-closed WASM adapter and never silently selects demo storage.
- [ ] Durable encrypted local repository and restart-safe outbox are integrated.
- [ ] A real client-to-client encrypted relay round trip passes.

## Calls and privacy

- [x] Server emits short-lived TURN HMAC credentials.
- [x] Web controller enforces `iceTransportPolicy: relay` in relay-only mode.
- [ ] A relay-only call, reconnect, and ICE restart pass against deployed TURN.
- [ ] Location grant revocation and recorded-video disclosure pass end-to-end tests.

## Operations and release

- [x] Local Compose defines PostgreSQL, Redis, MinIO, and Coturn.
- [x] CI, release attestation, SBOM, threat-model, DR, and monitoring artifacts exist.
- [ ] Provider-specific Terraform and production TLS/KMS configuration are deployed.
- [ ] Backup restore, sustained fuzzing, SAST/DAST, and penetration testing pass.
- [ ] Signed desktop/mobile/store release candidates are produced and rollback-tested.
- [ ] Limited beta, independent security review, and go/no-go approval are complete.

The application must remain in `HYBRID` mode until every unchecked security and
runtime gate above has independent evidence. Repository scaffolding is not proof
of production security.
