# Milestone 3 Architecture

Clients
├── iOS
├── Android
├── Web
└── Desktop
      │
      ▼
API Gateway
├── Auth
├── Device Federation
├── Key Directory
├── Key Transparency
├── Relay
├── Group/MLS
├── Attachments/CDN
├── Calls/TURN
├── Push
├── Enterprise
├── Billing
└── Emergency
      │
      ▼
Infrastructure
├── PostgreSQL
├── Redis
├── Object Storage
├── CDN
├── APNs
├── FCM
├── TURN pools
├── IdP/SCIM providers
├── Billing provider
└── Observability stack

## Core invariants

- Private keys remain client-side.
- Server never receives plaintext message bodies or file contents.
- New device approval must be authenticated by an existing trusted device or recovery path.
- Group epochs are monotonic.
- Key transparency is append-only.
- Push payloads contain no plaintext message content.
- Billing webhooks are signature-verified and idempotent.
- Emergency escalation is recipient-scoped and time-bounded.
