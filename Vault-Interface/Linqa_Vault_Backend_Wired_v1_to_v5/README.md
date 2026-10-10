# Linqa Vault — Backend Wired v1.0 → v5.0

This pack wires the Linqa Vault mobile UI model into a Node/TypeScript + Express + PostgreSQL platform while preserving the core trust boundary:

- Social/clients/messages may send a user-authorized copy **into** Vault.
- Vault is never directly browsable by Social.
- Vault → Social requires an explicit export grant and creates a separate outbound copy.
- Backend policy, not UI state, is authoritative.

## Version ladder

- **v1.0 Core Vault** — schema, repository, quota, folders/objects, upload sessions, API routes.
- **v2.0 Secure Intake** — Social/client intake gateway, quarantine, scanning state machine, idempotency.
- **v3.0 Business + Billing** — consumer/business workspaces, memberships/RBAC, plans/entitlements, retention/DLP policy hooks.
- **v4.0 Private + Export** — Private Vault step-up sessions, explicit export grants, secure links, audit chain.
- **v5.0 Production Closure** — outbox/workers, reconciliation, integrity verification, rate limits, metrics, release/certification gates.

Each version is additive. Apply SQL and wiring in order.
