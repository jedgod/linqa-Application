import type {
  QuotaAdapter,
  SecurityScannerAdapter,
  ShareAdapter,
  SocialImportAdapter,
  VaultAdapters,
  VaultIntegrationStatus
} from "./contracts.js";

/** No storage-quota accounting is wired up: every upload is allowed (the
 * real object-storage layer's own size limits, not a per-user quota, are
 * what currently bound uploads — see FailClosedVaultObjectStorage). */
export class SafeDefaultQuotaAdapter implements QuotaAdapter {
  readonly name = "unconfigured";
  async checkQuota(): Promise<{ allowed: true; usedBytes: number; limitBytes: null }> {
    return { allowed: true, usedBytes: 0, limitBytes: null };
  }
}

/** No malware/content scanner is configured. Reports SKIPPED rather than
 * fabricating CLEAN, so a caller can distinguish "scanned and safe" from
 * "never scanned" instead of conflating the two. */
export class SafeDefaultScannerAdapter implements SecurityScannerAdapter {
  readonly name = "unconfigured";
  async scanUpload(): Promise<{ status: "SKIPPED"; reasons: string[] }> {
    return { status: "SKIPPED", reasons: ["scanner_not_configured"] };
  }
}

/** No public share-link infrastructure exists yet (see FileVaultPage.tsx's
 * `available: false` share entries) — fails closed rather than minting a
 * link nothing serves. */
export class SafeDefaultShareAdapter implements ShareAdapter {
  readonly name = "unconfigured";
  async createShareLink(): Promise<never> {
    throw new Error("Vault share-link provider is not configured.");
  }
}

export class SafeDefaultSocialImportAdapter implements SocialImportAdapter {
  readonly name = "unconfigured";
  async listImportableItems(): Promise<{ items: never[] }> {
    return { items: [] };
  }
}

export function safeDefaultVaultAdapters(): VaultAdapters {
  return {
    quota: new SafeDefaultQuotaAdapter(),
    scanner: new SafeDefaultScannerAdapter(),
    share: new SafeDefaultShareAdapter(),
    socialImport: new SafeDefaultSocialImportAdapter()
  };
}

/**
 * The single source of truth `GET /v1/vault/integration-status` serves, and
 * that `clients/web/src/features/vault/integration-status.ts` reads —
 * replacing hand-written "not connected" strings scattered across
 * `FileVaultPage.tsx` with one server-reported status object. Values below
 * reflect what is genuinely wired today: encryption/hash-verification/the
 * client-side session lock are real; quota metering, scanning, sharing,
 * social import, and billing entitlements are not.
 */
export function currentVaultIntegrationStatus(adapters: VaultAdapters): VaultIntegrationStatus {
  return {
    encryptedStorage: true,
    hashVerification: true,
    privateVaultSessionLock: true,
    quotaMetering: adapters.quota.name !== "unconfigured",
    securityScanner: adapters.scanner.name !== "unconfigured",
    sharing: adapters.share.name !== "unconfigured",
    socialImport: adapters.socialImport.name !== "unconfigured",
    billingEntitlements: false
  };
}
