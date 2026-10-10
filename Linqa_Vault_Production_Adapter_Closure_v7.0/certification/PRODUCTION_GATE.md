# Vault production gate — ALL required
- [ ] Dedicated staging DB migration passes and rollback/forward strategy documented.
- [ ] Live principal adapter uses existing Linqa auth/session.
- [ ] Device trust uses Device Link v2; revoked/suspicious devices denied.
- [ ] Social/message/business ownership tests pass.
- [ ] Quarantine and ciphertext use different buckets/credentials.
- [ ] Social service IAM proves zero Vault/quarantine read access.
- [ ] Malware physical samples: EICAR blocked; clean corpus allowed; scanner outage fails closed.
- [ ] DLP policy tests pass for business tenant.
- [ ] Device import encrypts before server upload.
- [ ] Quarantine handoff -> client E2EE -> ciphertext upload tested on physical Android and iOS.
- [ ] Private Vault Face ID/Android biometric success/failure/lockout/recovery tested.
- [ ] Secure Link revoke/expire/download-limit tests pass.
- [ ] Linqa User + Vault-to-Vault + Email sharing tested.
- [ ] Export-to-Social creates COPY; original ID/key never reaches social.
- [ ] Billing sandbox checkout/webhook/refund/cancel/upgrade/downgrade tests pass.
- [ ] Raw webhook signature mutation/replay tests pass.
- [ ] 2FA/trusted device/login alert rows show live platform values.
- [ ] Outbox/reconciliation/purge workers healthy on exact SHA/digest.
- [ ] Backup restore drill completed; restored ciphertext decrypts only on authorized client.
- [ ] SAST/dependency/secret scan pass.
- [ ] DAST/API authorization tests pass.
- [ ] Tenant-isolation concurrency tests pass.
- [ ] Exact Git SHA and server/mobile artifact digests recorded.
- [ ] Rollback and kill switch tested.
- [ ] Production provider certifications APPROVED and unexpired.
- [ ] `/internal/ready/vault` returns 200 only after all above machine-verifiable checks.

No checklist item may be replaced by a mock result for production approval.
