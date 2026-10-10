import type { Database } from "../db/pool.js";

export interface VaultObjectStorage {
  createUpload(input: {
    objectKey: string;
    contentLength: number;
    contentType: string;
  }): Promise<{ uploadUrl: string; headers: Record<string, string> }>;

  createDownload(input: {
    objectKey: string;
  }): Promise<{ downloadUrl: string }>;

  delete(input: { objectKey: string }): Promise<void>;
}

export class FileVaultService {
  constructor(
    private readonly db: Database,
    private readonly storage: VaultObjectStorage
  ) {}

  async beginUpload(input: {
    userId: string;
    itemType: "DOCUMENT" | "IDENTITY" | "PHOTO" | "RECOVERY" | "OTHER";
    nameCiphertext: Buffer;
    metadataCiphertext: Buffer;
    keyEnvelope: Buffer;
    contentHash: Buffer;
    encryptedSize: number;
    contentType: string;
  }) {
    if (
      input.nameCiphertext.length < 16 ||
      input.metadataCiphertext.length < 16 ||
      input.keyEnvelope.length < 32 ||
      input.contentHash.length !== 32
    ) {
      throw new Error("invalid encrypted vault metadata");
    }

    const itemId = crypto.randomUUID();
    const objectKey = `vault/${input.userId}/${itemId}.bin`;

    const upload = await this.storage.createUpload({
      objectKey,
      contentLength: input.encryptedSize,
      contentType: input.contentType
    });

    await this.db.query(
      `INSERT INTO vault_items(
         id,user_id,item_type,name_ciphertext,metadata_ciphertext,
         object_key,content_hash,encrypted_size,key_envelope
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        itemId,
        input.userId,
        input.itemType,
        input.nameCiphertext,
        input.metadataCiphertext,
        objectKey,
        input.contentHash,
        input.encryptedSize,
        input.keyEnvelope
      ]
    );

    return { itemId, ...upload };
  }

  async list(userId: string, privateOnly = false) {
    const result = await this.db.query(
      `SELECT id,item_type,name_ciphertext,metadata_ciphertext,
              content_hash,encrypted_size,key_envelope,version,created_at
       FROM vault_items
       WHERE user_id=$1 AND deleted_at IS NULL
         AND CASE WHEN $2::boolean THEN item_type IN ('IDENTITY','RECOVERY') ELSE item_type NOT IN ('IDENTITY','RECOVERY') END
       ORDER BY created_at DESC`,
      [userId, privateOnly]
    );

    return result.rows;
  }

  async isPrivateItem(userId: string,itemId: string) {
    const row = (await this.db.query(`SELECT item_type FROM vault_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`,[itemId,userId])).rows[0];
    if (!row) throw new Error("vault item not found");
    return ["IDENTITY","RECOVERY"].includes(row.item_type);
  }

  async download(userId: string, itemId: string) {
    const result = await this.db.query(
      `SELECT object_key,key_envelope,content_hash
       FROM vault_items
       WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`,
      [itemId, userId]
    );

    const row = result.rows[0];
    if (!row) throw new Error("vault item not found");

    return {
      ...(await this.storage.createDownload({ objectKey: row.object_key })),
      keyEnvelopeBase64: (row.key_envelope as Buffer).toString("base64"),
      contentHashBase64: (row.content_hash as Buffer).toString("base64")
    };
  }
}
