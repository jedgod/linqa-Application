# Release closure gates

1. Dedicated test/staging DB only; migration 048 applies/rolls forward cleanly.
2. Existing Linqa auth middleware populates userId/deviceId/sessionId; no body-supplied identity is trusted.
3. Social/message/client resolvers enforce source authorization before returning bytes.
4. Quarantine bucket has no public access, short TTL, separate credentials/network policy and deletion evidence.
5. Scanner failure is fail-closed; DLP BLOCK is fail-closed.
6. Direct device uploads are client-encrypted; server does not claim plaintext scan.
7. `/files` proves tenant isolation and displays finalized imports.
8. Secure-link token stored only as SHA-256 hash; expiry/revocation/max-download enforced atomically in production resolver.
9. Email contains secure-link URL only, never storage URL.
10. Linqa-user and Vault-to-Vault transfers require recipient acceptance before recipient gets wrapped object key/ciphertext access.
11. Social export uses a new social object and never a Vault URL/object ID as the attachment.
12. Private Vault session is device-bound, step-up-bound, <=5 minutes and revoked on background/logout/security-epoch change.
13. 2FA/trusted devices/login alerts are sourced from platform IAM, not fabricated Vault counters.
14. Billing uses signed raw-body webhooks, idempotent event IDs, server-owned plan catalog and atomic entitlement update.
15. Outbox/reconciliation workers have leases, retry/backoff and DLQ alerts.
16. Audit events cover intake/share/private/billing/security-setting actions without plaintext filenames/content.
17. SAST/dependency/secret scan passes.
18. iOS + Android physical-device flows pass.
19. Exact Git SHA + migration digest + build artifact digest recorded.
20. Kill switches exist for intake, sharing, social export and billing before limited launch.
