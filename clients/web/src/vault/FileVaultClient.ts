import { WebCryptoKeyProvider } from "../security/WebCryptoKeyProvider";

const WRAPPING_KEY_ALIAS = "vault-master";

export type VaultItemType = "DOCUMENT" | "IDENTITY" | "PHOTO" | "RECOVERY" | "OTHER";

export interface VaultItemSummary {
  id: string;
  itemType: VaultItemType;
  name: string;
  metadata: Record<string, unknown>;
  encryptedSize: number;
  version: number;
  createdAt: string;
}

interface RawVaultItemRow {
  id: string;
  item_type: VaultItemType;
  name_ciphertext: BufferLike;
  metadata_ciphertext: BufferLike;
  content_hash: BufferLike;
  encrypted_size: number;
  key_envelope: BufferLike;
  version: number;
  created_at: string;
}

type BufferLike = string | { type: "Buffer"; data: number[] };

function bufferLikeToBytes(value: BufferLike): Uint8Array {
  if (typeof value === "string") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return Uint8Array.from(value.data);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
}

async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt"
  ]);
}

async function encryptWithDataKey(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, Uint8Array.from(plaintext))
  );
  const out = new Uint8Array(12 + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, 12);
  return out;
}

async function decryptWithDataKey(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 12) throw new Error("invalid sealed vault field");
  const nonce = sealed.slice(0, 12);
  const ciphertext = sealed.slice(12);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, Uint8Array.from(ciphertext))
  );
}

function itemTypeContext(itemType: VaultItemType): Uint8Array {
  return new TextEncoder().encode(`linqa:file-vault:${itemType}`);
}

export interface FileVaultHttp {
  fetch: typeof fetch;
}

export class FileVaultClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getAuthToken: () => Promise<string>,
    private readonly keys: WebCryptoKeyProvider = new WebCryptoKeyProvider(),
    private readonly http: FileVaultHttp = { fetch: fetch.bind(globalThis) }
  ) {}

  async upload(input: {
    itemType: VaultItemType;
    name: string;
    metadata: Record<string, unknown>;
    content: Uint8Array;
    contentType: string;
  }): Promise<{ itemId: string }> {
    await this.keys.createWrappingKey(WRAPPING_KEY_ALIAS);

    const dataKey = await generateDataKey();
    const rawDataKey = new Uint8Array(await crypto.subtle.exportKey("raw", dataKey));

    const nameCiphertext = await encryptWithDataKey(
      dataKey,
      new TextEncoder().encode(input.name)
    );
    const metadataCiphertext = await encryptWithDataKey(
      dataKey,
      new TextEncoder().encode(JSON.stringify(input.metadata))
    );
    const encryptedContent = await encryptWithDataKey(dataKey, input.content);
    const contentHash = await sha256(encryptedContent);

    const keyEnvelope = await this.keys.wrapKey({
      alias: WRAPPING_KEY_ALIAS,
      rawKey: rawDataKey,
      context: itemTypeContext(input.itemType)
    });

    const beginResponse = await this.authorizedFetch("/v1/vault/items", {
      method: "POST",
      body: {
        itemType: input.itemType,
        nameCiphertextBase64: bytesToBase64(nameCiphertext),
        metadataCiphertextBase64: bytesToBase64(metadataCiphertext),
        keyEnvelopeBase64: bytesToBase64(keyEnvelope),
        contentHashBase64: bytesToBase64(contentHash),
        encryptedSize: encryptedContent.length,
        contentType: input.contentType
      }
    });

    if (!beginResponse.ok) {
      throw new Error(`vault upload could not be started (${beginResponse.status})`);
    }

    const begin = (await beginResponse.json()) as {
      itemId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };

    const uploadResponse = await this.http.fetch(begin.uploadUrl, {
      method: "PUT",
      headers: begin.headers,
      body: encryptedContent.buffer.slice(
        encryptedContent.byteOffset,
        encryptedContent.byteOffset + encryptedContent.byteLength
      ) as ArrayBuffer
    });

    if (!uploadResponse.ok) {
      throw new Error(`vault object upload failed (${uploadResponse.status})`);
    }

    return { itemId: begin.itemId };
  }

  async list(): Promise<VaultItemSummary[]> {
    const response = await this.authorizedFetch("/v1/vault/items", { method: "GET" });
    if (!response.ok) throw new Error(`vault listing failed (${response.status})`);

    const body = (await response.json()) as { items: RawVaultItemRow[] };
    const items: VaultItemSummary[] = [];
    for (const row of body.items) {
      const dataKey = await this.unwrapDataKey(row.key_envelope, row.item_type);
      const name = new TextDecoder().decode(
        await decryptWithDataKey(dataKey, bufferLikeToBytes(row.name_ciphertext))
      );
      const metadataJson = new TextDecoder().decode(
        await decryptWithDataKey(dataKey, bufferLikeToBytes(row.metadata_ciphertext))
      );
      items.push({
        id: row.id,
        itemType: row.item_type,
        name,
        metadata: JSON.parse(metadataJson) as Record<string, unknown>,
        encryptedSize: row.encrypted_size,
        version: row.version,
        createdAt: row.created_at
      });
    }
    return items;
  }

  async download(itemId: string, itemType: VaultItemType): Promise<Uint8Array> {
    const response = await this.authorizedFetch(`/v1/vault/items/${itemId}/download`, {
      method: "GET"
    });
    if (!response.ok) throw new Error(`vault download failed (${response.status})`);

    const meta = (await response.json()) as {
      downloadUrl: string;
      keyEnvelopeBase64: string;
      contentHashBase64: string;
    };

    const objectResponse = await this.http.fetch(meta.downloadUrl);
    if (!objectResponse.ok) {
      throw new Error(`vault object download failed (${objectResponse.status})`);
    }
    const encryptedContent = new Uint8Array(await objectResponse.arrayBuffer());

    const actualHash = await sha256(encryptedContent);
    const expectedHash = bufferLikeToBytes(meta.contentHashBase64);
    if (bytesToBase64(actualHash) !== bytesToBase64(expectedHash)) {
      throw new Error("vault object failed integrity verification");
    }

    const dataKey = await this.unwrapDataKey(meta.keyEnvelopeBase64, itemType);
    return decryptWithDataKey(dataKey, encryptedContent);
  }

  private async unwrapDataKey(
    keyEnvelope: BufferLike,
    itemType: VaultItemType
  ): Promise<CryptoKey> {
    const rawDataKey = await this.keys.unwrapKey({
      alias: WRAPPING_KEY_ALIAS,
      wrappedKey: bufferLikeToBytes(keyEnvelope),
      context: itemTypeContext(itemType)
    });
    return crypto.subtle.importKey("raw", Uint8Array.from(rawDataKey), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt"
    ]);
  }

  private async authorizedFetch(
    path: string,
    init: { method: string; body?: unknown }
  ): Promise<Response> {
    const token = await this.getAuthToken();
    return this.http.fetch(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });
  }
}
