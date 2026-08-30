# Linqa Operations Platform — Implementation Pack

This pack expands the Linqa Admin/Staff Console into 12 operational workspaces:

1. Staff Management
2. Client 360 Support View
3. Real-time Support Chat
4. LinqaSend Transaction Investigation
5. Vault Quarantine Review
6. Account Recovery Verification
7. Trust & Safety Moderation
8. Fraud / Risk Cases
9. Supervisor Coaching and QA
10. Workforce Scheduling
11. Incident Command
12. Executive Admin Analytics

## Design rules

- Admin, supervisor and specialist privileges are separated by explicit RBAC permissions.
- Every privileged mutation should require a reason and append an immutable audit event.
- Client 360 is minimum-necessary and masked by default.
- Operations access does not silently bypass Linqa E2EE.
- Vault operations review quarantine metadata, hashes, scanner results and user-authorized evidence, not Vault plaintext or encryption keys.
- LinqaSend operations must never expose PAN/CVV or raw payment credentials.
- Break-glass access should be short-lived, approved, scoped, alerted and audited.
- Executive analytics is aggregate/read-only and should not become a back door to individual private data.

## Wiring

Mount `opsRouter` under `/api/ops` behind staff authentication + MFA. Bind `LinqaOperationsPlatform.tsx` to those endpoints and your staff WebSocket gateway. Replace placeholder route bodies with service/repository calls inside the existing Linqa server architecture.

Recommended production layers:
`route -> auth/RBAC -> validation -> service -> repository -> audit/outbox -> websocket/event bus`

Do not call privileged domain services directly from UI code.
