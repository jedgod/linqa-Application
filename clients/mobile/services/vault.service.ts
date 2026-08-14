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

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${await this.token()}` }
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
}
