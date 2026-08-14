import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileVaultClient, type FileVaultHttp } from "./FileVaultClient";

describe("FileVaultClient", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("linqa-key-custody");
  });

  it("encrypts name/metadata/content client-side, uploads, then lists and decrypts them back", async () => {
    let uploadedBytes: Uint8Array | undefined;
    let storedItem: {
      id: string;
      item_type: "DOCUMENT";
      name_ciphertext: string;
      metadata_ciphertext: string;
      content_hash: string;
      encrypted_size: number;
      key_envelope: string;
      version: number;
      created_at: string;
    } | undefined;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/vault/items") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as {
          itemType: "DOCUMENT";
          nameCiphertextBase64: string;
          metadataCiphertextBase64: string;
          keyEnvelopeBase64: string;
          contentHashBase64: string;
          encryptedSize: number;
        };
        storedItem = {
          id: "item-1",
          item_type: body.itemType,
          name_ciphertext: body.nameCiphertextBase64,
          metadata_ciphertext: body.metadataCiphertextBase64,
          content_hash: body.contentHashBase64,
          encrypted_size: body.encryptedSize,
          key_envelope: body.keyEnvelopeBase64,
          version: 1,
          created_at: new Date().toISOString()
        };
        return new Response(
          JSON.stringify({
            itemId: "item-1",
            uploadUrl: "https://storage.test/upload/item-1",
            headers: { "Content-Type": "application/octet-stream" }
          }),
          { status: 201 }
        );
      }

      if (url === "https://storage.test/upload/item-1" && init?.method === "PUT") {
        uploadedBytes = new Uint8Array(init.body as ArrayBuffer);
        return new Response(null, { status: 200 });
      }

      if (url.endsWith("/v1/vault/items") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ items: storedItem ? [storedItem] : [] }), {
          status: 200
        });
      }

      throw new Error(`unexpected fetch: ${String(input)} ${init?.method ?? "GET"}`);
    });

    const http: FileVaultHttp = { fetch: fetchMock as unknown as typeof fetch };
    const client = new FileVaultClient(
      "https://api.test",
      async () => "test-token",
      undefined,
      http
    );

    const plaintext = new TextEncoder().encode("top secret contents");
    const { itemId } = await client.upload({
      itemType: "DOCUMENT",
      name: "passport.pdf",
      metadata: { pages: 2 },
      content: plaintext,
      contentType: "application/pdf"
    });

    expect(itemId).toBe("item-1");
    expect(uploadedBytes).toBeDefined();
    // The bytes sent to object storage must not equal the plaintext — proves
    // this is a real client-side encryption path, not a passthrough.
    expect(Array.from(uploadedBytes!)).not.toEqual(Array.from(plaintext));

    const items = await client.list();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("passport.pdf");
    expect(items[0].metadata).toEqual({ pages: 2 });
  });

  it("rejects a downloaded object whose bytes fail integrity verification", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/vault/items/item-1/download")) {
        return new Response(
          JSON.stringify({
            downloadUrl: "https://storage.test/download/item-1",
            keyEnvelopeBase64: btoa("not-a-real-envelope-but-32-bytes!!"),
            contentHashBase64: btoa("0123456789012345678901234567890X")
          }),
          { status: 200 }
        );
      }
      if (url === "https://storage.test/download/item-1") {
        return new Response(new TextEncoder().encode("tampered ciphertext bytes"), {
          status: 200
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const http: FileVaultHttp = { fetch: fetchMock as unknown as typeof fetch };
    const client = new FileVaultClient(
      "https://api.test",
      async () => "test-token",
      undefined,
      http
    );

    await expect(client.download("item-1", "DOCUMENT")).rejects.toThrow(
      "vault object failed integrity verification"
    );
  });

  it("throws when the wrapping key has never been created (no prior upload on this device)", async () => {
    const emptyContent = new Uint8Array(0);
    const emptyHashBase64 = btoa(
      String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", emptyContent)))
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/vault/items/item-1/download")) {
        return new Response(
          JSON.stringify({
            downloadUrl: "https://storage.test/download/item-1",
            keyEnvelopeBase64: btoa("x".repeat(32)),
            contentHashBase64: emptyHashBase64
          }),
          { status: 200 }
        );
      }
      if (url === "https://storage.test/download/item-1") {
        return new Response(emptyContent, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const http: FileVaultHttp = { fetch: fetchMock as unknown as typeof fetch };
    const client = new FileVaultClient(
      "https://api.test",
      async () => "test-token",
      undefined,
      http
    );

    // Integrity check passes (hash matches), so this exercises the real
    // failure path: no wrapping key exists yet on this device.
    await expect(client.download("item-1", "DOCUMENT")).rejects.toThrow(
      "wrapping key not found"
    );
  });
});
