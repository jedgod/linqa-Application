export type VaultIntegrationStatus = {
  encryptedStorage: boolean;
  hashVerification: boolean;
  privateVaultSessionLock: boolean;
  quotaMetering: boolean;
  securityScanner: boolean;
  sharing: boolean;
  socialImport: boolean;
  billingEntitlements: boolean;
};

export type EncryptedVaultItem = {
  id: string;
  item_type: "DOCUMENT" | "IDENTITY" | "PHOTO" | "RECOVERY" | "OTHER";
  encrypted_size: number;
  version: number;
  created_at: string;
};

export class VaultService {
  constructor(private readonly baseUrl: string, private readonly token: () => Promise<string>) {}

  private async request<T>(path: string, init?: { method: "POST" | "PUT" | "DELETE"; body?: unknown }): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: { authorization: `Bearer ${await this.token()}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Vault request failed");
    return payload as T;
  }

  integrationStatus() {
    return this.request<VaultIntegrationStatus>("/v1/vault/integration-status");
  }

  listItems() {
    return this.request<{ items: EncryptedVaultItem[] }>("/v1/vault/items");
  }

  listFolders() {
    return this.request<{ folders: VaultFolder[] }>("/v1/vault/folders");
  }

  createFolder(name: string, parentId?: string) {
    return this.request<{ id: string; parentId: string | null; name: string }>("/v1/vault/folders", { method: "POST", body: { name, ...(parentId ? { parentId } : {}) } });
  }

  /** The user has seen the notice that the file is scanned in quarantine before the device encrypts it. */
  startSocialImport(sourceAttachmentId: string, folderId?: string) {
    return this.request<{ importId: string; status: string }>("/v1/vault/imports/social", { method: "POST", body: { sourceAttachmentId, plaintextInspectionConsent: true, ...(folderId ? { folderId } : {}) } });
  }

  capabilities() {
    return this.request<VaultCapabilities>("/v1/vault/intake/capabilities");
  }

  files(options: { tag?: string; cursor?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (options.tag) query.set("tag", options.tag);
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit) query.set("limit", String(options.limit));
    const suffix = query.toString();
    return this.request<{ workspaceId: string; items: VaultObject[]; nextCursor: string | null }>(`/v1/vault/files${suffix ? `?${suffix}` : ""}`);
  }

  securityCenter() {
    return this.request<VaultSecurityCenter>("/v1/vault/security-center");
  }

  setLoginAlerts(enabled: boolean) {
    return this.request<{ enabled: boolean }>("/v1/vault/security-center/login-alerts", { method: "PUT", body: { enabled } });
  }

  shareWithLinqaUser(objectId: string, recipient: string) {
    return this.request<{ transferId: string; state: string }>("/v1/vault/share/linqa-user", { method: "POST", body: { objectId, recipient } });
  }

  createSecureLink(objectId: string, expiresMinutes: number, maxDownloads?: number) {
    return this.request<{ linkId: string; expiresAt: string; url: string }>("/v1/vault/share/secure-links", { method: "POST", body: { objectId, expiresMinutes, ...(maxDownloads ? { maxDownloads } : {}) } });
  }

  revokeSecureLink(linkId: string) {
    return this.request<{ linkId: string; revoked: boolean }>(`/v1/vault/share/secure-links/${encodeURIComponent(linkId)}`, { method: "DELETE" });
  }

  shareByEmail(objectId: string, email: string, expiresMinutes: number) {
    return this.request<{ linkId: string; state: string }>("/v1/vault/share/email", { method: "POST", body: { objectId, email, expiresMinutes } });
  }

  checkout(planCode: string, urls: { successUrl: string; cancelUrl: string }, idempotencyKey: string) {
    return this.request<{ checkoutUrl: string; sessionRef: string }>("/v1/vault/billing/checkout", { method: "POST", body: { planCode, idempotencyKey, ...urls } });
  }

  importStatus(importId: string) {
    return this.request<VaultImportStatus>(`/v1/vault/imports/${encodeURIComponent(importId)}/status`);
  }

  /** Asks for the clean copy. The device must encrypt it with the vault key before anything is stored. */
  handoffImport(importId: string) {
    return this.request<{ importId: string; state: string; handoffToken: string; url: string; expiresIn: number; instruction: string }>(`/v1/vault/imports/${encodeURIComponent(importId)}/handoff`, { method: "POST", body: {} });
  }

  plans() {
    return this.request<VaultPlans>("/v1/vault/plans");
  }
}

export type VaultCapabilities = { scanner: boolean; sharing: boolean; email: boolean; socialImport: boolean; socialExport: boolean; billing: boolean };

export type VaultObject = { id: string; folderId: string | null; sizeBytes: number; encryptedMetadata: unknown; contentEncryption: string; classification: string; createdAt: string; tags: string[] };

export type VaultSecurityCenter = {
  encryption: { enabled: boolean; mode: string };
  integrity: { enabled: boolean; auditEvents: number };
  scanner: { configured: boolean };
  sharing: { configured: boolean; email: boolean; socialExport: boolean };
  socialImport: { configured: boolean };
  billing: { configured: boolean };
  twoFactor: { enabled: boolean; methods: string[] };
  trustedDevices: { count: number; devices: Array<{ id: string; name: string; platform: string; trusted: boolean; lastSeenAt: string | null }> };
  loginAlerts: { enabled: boolean };
  autoLockMinutes: number;
};

export type VaultFolder = { id: string; parentId: string | null; name: string; path: string };

export type VaultImportState = "RECEIVED" | "FETCHING" | "QUARANTINED" | "SCANNING" | "AWAITING_CONFIRMATION" | "HANDOFF_READY" | "COMPLETED" | "VAULTED" | "BLOCKED" | "FAILED" | "PURGED";

export type VaultImportStatus = {
  importId: string;
  state: VaultImportState;
  progress: number;
  filename: string | null;
  sizeBytes: number | null;
  failureCode: string | null;
  checks: Array<{ key: string; label: string; state: "done" | "active" | "pending" | "failed" }>;
};

export type VaultPlans = {
  billingAvailable: boolean;
  current: { planCode: string; quotaBytes: number; usedBytes: number; reservedBytes: number };
  plans: Array<{ code: string; quotaBytes: number; monthlyPriceMinor: number; currency: string }>;
};
