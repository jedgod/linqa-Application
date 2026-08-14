# Linqa Disaster Recovery Runbook

1. Declare the incident, freeze deployments, and preserve audit evidence.
2. Identify the affected region and last verified backup.
3. Restore PostgreSQL into an isolated environment and run integrity checks.
4. Restore object metadata and verify ciphertext checksums.
5. Rotate affected credentials and revoke exposed sessions/devices.
6. Start the API in read-only mode and verify auth, relay, key directory, and sync.
7. Re-enable writes gradually with heightened monitoring.
8. Record measured RTO, RPO, data loss, decisions, and follow-up actions.

The existing `restore-test.sh` must pass against production-equivalent encrypted
backups before this runbook can be marked exercised.
