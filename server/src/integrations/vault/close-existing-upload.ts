import type { FileVaultService } from "../../services/file-vault.service.js";
import type { VaultAdapters } from "./contracts.js";

/**
 * Thin wrapper around the existing, real `FileVaultService.beginUpload` —
 * does not reimplement upload handling, only adds the quota-check and
 * scan-status reporting this repo didn't have before. Scanning is reported
 * (SKIPPED, by default) rather than persisted to a new column: vault
 * content is end-to-end encrypted before it ever reaches this server (see
 * `clients/web/src/vault/FileVaultClient.ts`), so a server-side malware
 * scanner has no plaintext to inspect in the first place — "not
 * configured" is the honest, permanent state here, not a placeholder for
 * a future integration.
 */
export async function beginUploadWithIntegrations(
  fileVault: FileVaultService,
  adapters: VaultAdapters,
  input: Parameters<FileVaultService["beginUpload"]>[0]
): Promise<Awaited<ReturnType<FileVaultService["beginUpload"]>> & { scanStatus: string; quotaAllowed: boolean }> {
  const quota = await adapters.quota.checkQuota({ userId: input.userId, additionalBytes: input.encryptedSize });
  if (!quota.allowed) {
    throw new Error("VAULT_QUOTA_EXCEEDED");
  }

  const result = await fileVault.beginUpload(input);

  const scan = await adapters.scanner.scanUpload({
    userId: input.userId,
    itemId: result.itemId,
    encryptedSize: input.encryptedSize,
    contentType: input.contentType
  });

  return { ...result, scanStatus: scan.status, quotaAllowed: quota.allowed };
}
