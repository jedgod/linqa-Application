# Linqa Stages 6–10 Acceptance Tests

## Attachments

- Encrypts files before upload.
- Uses unique random content key per attachment.
- Uses unique nonce per chunk.
- Rejects altered ciphertext.
- Rejects missing and reordered chunks.
- Never uploads attachment key to object storage.
- Deletes expired incomplete uploads.

## Groups

- Only owners/admins can modify group membership.
- Every membership change advances epoch exactly once.
- Removed devices cannot decrypt later epochs.
- Group state hash chain is verified.
- Conflicting group states are detected.
- Group invitation expires and cannot be reused.

## Sync

- Duplicate client record IDs are idempotent.
- Device never applies the same logical record twice.
- Tombstones remove local state.
- Failed decryptions do not advance cursor.
- Offline device catches up after reconnecting.
- Revoked device cannot pull sync data.

## Backup

- Wrong passphrase cannot restore.
- Modified backup fails integrity validation.
- Backup key is never sent to server.
- Restore requires step-up authentication.
- High-risk restore honors recovery hold.
- Restored keys match expected public identities.

## Operations

- Kill switches prevent sensitive operations.
- Audit logs redact secrets and message content.
- Metrics do not include phone, email, message text, or ciphertext.
- Cleanup jobs are idempotent.
- Security alerts are issued for new devices and recovery.
