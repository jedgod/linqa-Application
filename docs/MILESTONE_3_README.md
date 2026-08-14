# Linqa Milestone 3 — Production Federation & Scale
Date: 2026-08-07

This milestone follows successful completion of:
- Milestone 1: Authentication → Home → Chats → Conversation → Calls → File Vault → Privacy/Security
- Milestone 2: Contacts + Status → Communities → Calendar + Notes → Screen Sharing → AI → Wallet → Premium/Billing → Enterprise → Emergency

## Milestone 3 scope

1. Multi-device federation per user
2. MLS group security integration boundary
3. Key-transparency user interface + proof APIs
4. APNs + FCM production push delivery
5. Regional TURN pool selection
6. Attachment CDN + signed delivery
7. Production SSO + SCIM provider integration
8. Billing webhook reconciliation
9. Emergency escalation engine
10. Load and chaos testing
11. App-store build/release pipelines
12. Canary production rollout + automatic rollback

## Production rule

Milestone 3 is not considered complete until:
- one user is verified on 3 devices;
- 3 users exchange messages across at least 5 active devices;
- an MLS group survives membership changes and epoch rotation;
- key-transparency proofs verify in client UI;
- push works on iOS and Android production credentials;
- TURN routing works across at least 2 regions;
- attachments are encrypted client-side and served via signed CDN URLs;
- SSO/SCIM tenant isolation passes;
- billing entitlements reconcile from provider webhooks;
- emergency escalation resolves to authorized recipients only;
- load, chaos, canary and rollback tests pass.

## Status in this repository (2026-08-07 apply pass)

Per this session's diagnostic (claudeassess.txt), "Milestone 2" as
described above (Contacts+Status, Communities, Calendar+Notes, Screen
Sharing, AI, Wallet, Premium/Billing, Enterprise, **Emergency**) was never
actually applied to this repository as a discrete numbered pack. Some of
its listed pieces exist under different names from earlier, differently-
scoped packs (Communities, AI job queue, Premium/entitlements, Enterprise
policies all exist in some form); Emergency did not exist in any form —
`emergency_events`/`emergency_authorizations_v2` were added as part of
applying this pack (see migration 017's comments) purely so
`EmergencyEscalationService` has a real, testable foundation rather than a
broken foreign key.

Applying this pack does not by itself satisfy the "production rule" above
— every provider referenced in section 4 of the apply guide (APNs, FCM,
Redis, TURN, object storage/CDN, SSO/SCIM, billing, emergency notifier) is
fail-closed by default in this environment, matching how every other
unconfigured external integration in this repo behaves.
