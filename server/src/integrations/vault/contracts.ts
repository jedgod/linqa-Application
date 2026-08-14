/**
 * Vault capabilities `FileVaultPage.tsx` already displays as honest "not
 * connected" text (see clients/web/src/pages/FileVaultPage.tsx) instead of
 * fabricating them. These interfaces give that honesty a typed, checkable
 * shape server-side — one adapter per capability — instead of leaving it as
 * only a UI-layer string. Genuinely new: none of these existed before.
 */

export interface QuotaAdapter {
  readonly name: string;
  checkQuota(input: { userId: string; additionalBytes: number }): Promise<{
    allowed: boolean;
    usedBytes: number;
    limitBytes: number | null;
  }>;
}

export interface SecurityScannerAdapter {
  readonly name: string;
  scanUpload(input: { userId: string; itemId: string; encryptedSize: number; contentType: string }): Promise<{
    status: "CLEAN" | "FLAGGED" | "SKIPPED";
    reasons: string[];
  }>;
}

export interface ShareAdapter {
  readonly name: string;
  createShareLink(input: { userId: string; itemId: string; expiresInSeconds: number }): Promise<{
    shareUrl: string;
    expiresAt: Date;
  }>;
}

export interface SocialImportAdapter {
  readonly name: string;
  listImportableItems(input: { userId: string; provider: string }): Promise<{ items: Array<{ id: string; label: string }> }>;
}

export interface VaultAdapters {
  quota: QuotaAdapter;
  scanner: SecurityScannerAdapter;
  share: ShareAdapter;
  socialImport: SocialImportAdapter;
}

export interface VaultIntegrationStatus {
  encryptedStorage: boolean;
  hashVerification: boolean;
  privateVaultSessionLock: boolean;
  quotaMetering: boolean;
  securityScanner: boolean;
  sharing: boolean;
  socialImport: boolean;
  billingEntitlements: boolean;
}
