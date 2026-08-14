import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { FileVaultService, type VaultObjectStorage } from "../services/file-vault.service.js";

function validInput(overrides: Partial<Parameters<FileVaultService["beginUpload"]>[0]> = {}) {
  return {
    userId: "user-1",
    itemType: "DOCUMENT" as const,
    nameCiphertext: Buffer.alloc(16, 1),
    metadataCiphertext: Buffer.alloc(16, 2),
    keyEnvelope: Buffer.alloc(32, 3),
    contentHash: Buffer.alloc(32, 4),
    encryptedSize: 1024,
    contentType: "application/octet-stream",
    ...overrides
  };
}

describe("FileVaultService", () => {
  it("issues an upload target and persists vault item metadata", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO vault_items")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    });
    const storage: VaultObjectStorage = {
      createUpload: vi.fn(async () => ({
        uploadUrl: "https://example.test/upload",
        headers: { "Content-Type": "application/octet-stream" }
      })),
      createDownload: vi.fn(async () => ({ downloadUrl: "https://example.test/download" })),
      delete: vi.fn(async () => {})
    };

    const service = new FileVaultService({ query } as unknown as Database, storage);
    const result = await service.beginUpload(validInput());

    expect(result.uploadUrl).toBe("https://example.test/upload");
    expect(storage.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({ contentLength: 1024, contentType: "application/octet-stream" })
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it("rejects metadata that is too short to be real ciphertext", async () => {
    const query = vi.fn();
    const storage: VaultObjectStorage = {
      createUpload: vi.fn(),
      createDownload: vi.fn(),
      delete: vi.fn()
    };
    const service = new FileVaultService({ query } as unknown as Database, storage);

    await expect(
      service.beginUpload(validInput({ nameCiphertext: Buffer.alloc(4) }))
    ).rejects.toThrow("invalid encrypted vault metadata");
    expect(storage.createUpload).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed when object storage is not configured", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const { FailClosedVaultObjectStorage } = await import(
      "../services/storage/vault-object-storage.js"
    );
    const service = new FileVaultService(
      { query } as unknown as Database,
      new FailClosedVaultObjectStorage()
    );

    await expect(service.beginUpload(validInput())).rejects.toThrow(
      "Vault object storage is not configured."
    );
  });

  it("scopes download to the owning user and returns the key envelope", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM vault_items")) {
        return {
          rows: [{
            object_key: "vault/user-1/item-1.bin",
            key_envelope: Buffer.from("envelope"),
            content_hash: Buffer.from("hash")
          }],
          rowCount: 1
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const storage: VaultObjectStorage = {
      createUpload: vi.fn(),
      createDownload: vi.fn(async () => ({ downloadUrl: "https://example.test/download" })),
      delete: vi.fn()
    };

    const service = new FileVaultService({ query } as unknown as Database, storage);
    const result = await service.download("user-1", "item-1");

    expect(result.downloadUrl).toBe("https://example.test/download");
    expect(result.keyEnvelopeBase64).toBe(Buffer.from("envelope").toString("base64"));
    expect(storage.createDownload).toHaveBeenCalledWith({ objectKey: "vault/user-1/item-1.bin" });
  });

  it("throws when the item does not exist for that user", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const storage: VaultObjectStorage = {
      createUpload: vi.fn(),
      createDownload: vi.fn(),
      delete: vi.fn()
    };
    const service = new FileVaultService({ query } as unknown as Database, storage);

    await expect(service.download("user-1", "missing-item")).rejects.toThrow(
      "vault item not found"
    );
  });
});
