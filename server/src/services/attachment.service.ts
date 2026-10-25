import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool.js";

export interface ObjectStorage {
  createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ uploadId: string }>;

  signPartUpload(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<{ url: string }>;

  completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<void>;

  /** A short-lived GET link for a stored (ciphertext) object. Callers must authorize the requester before asking for one. */
  signDownload(input: { objectKey: string; expiresInSeconds: number }): Promise<{ url: string }>;

  deleteObject(objectKey: string): Promise<void>;
}

export class AttachmentService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage
  ) {}

  async createUpload(input: {
    userId: string;
    deviceId: string;
    mediaType: string;
    ciphertextSize: number;
    chunkCount: number;
    manifestHash: Buffer;
  }) {
    if (input.ciphertextSize <= 0 || input.ciphertextSize > 500 * 1024 * 1024) {
      throw new Error("invalid attachment size");
    }
    if (input.chunkCount <= 0 || input.chunkCount > 10_000) {
      throw new Error("invalid chunk count");
    }

    const objectKey = `attachments/${input.userId}/${randomUUID()}`;
    const upload = await this.storage.createMultipartUpload({
      objectKey,
      contentType: "application/octet-stream",
      expiresInSeconds: 900
    });

    const inserted = await this.db.query(
      `INSERT INTO attachment_uploads (
         owner_user_id,
         owner_device_id,
         object_key,
         media_type,
         ciphertext_size,
         chunk_count,
         manifest_hash,
         status,
         expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'UPLOADING',now() + interval '24 hours')
       RETURNING id`,
      [
        input.userId,
        input.deviceId,
        objectKey,
        input.mediaType,
        input.ciphertextSize,
        input.chunkCount,
        input.manifestHash
      ]
    );

    return {
      attachmentId: inserted.rows[0].id as string,
      objectKey,
      uploadId: upload.uploadId
    };
  }

  async signPart(
    userId: string,
    attachmentId: string,
    uploadId: string,
    partNumber: number
  ) {
    const result = await this.db.query(
      `SELECT object_key, chunk_count, status
       FROM attachment_uploads
       WHERE id = $1 AND owner_user_id = $2`,
      [attachmentId, userId]
    );
    const row = result.rows[0];

    if (!row || row.status !== "UPLOADING") {
      throw new Error("upload not available");
    }
    if (partNumber < 1 || partNumber > row.chunk_count) {
      throw new Error("invalid part number");
    }

    return this.storage.signPartUpload({
      objectKey: row.object_key,
      uploadId,
      partNumber,
      expiresInSeconds: 600
    });
  }

  async complete(input: {
    userId: string;
    attachmentId: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT object_key, chunk_count, status, media_type, manifest_hash
         FROM attachment_uploads
         WHERE id = $1 AND owner_user_id = $2
         FOR UPDATE`,
        [input.attachmentId, input.userId]
      );
      const row = result.rows[0];

      if (!row || row.status !== "UPLOADING") {
        throw new Error("upload cannot be completed");
      }
      if (input.parts.length !== row.chunk_count) {
        throw new Error("incomplete multipart upload");
      }

      await this.storage.completeMultipartUpload({
        objectKey: row.object_key,
        uploadId: input.uploadId,
        parts: input.parts
      });

      await client.query(
        `UPDATE attachment_uploads
         SET status = 'COMPLETE', completed_at = now()
         WHERE id = $1`,
        [input.attachmentId]
      );

      await client.query(
        `INSERT INTO media_index(
           user_id,media_type,object_key,metadata_ciphertext
         ) VALUES($1,$2,$3,$4)
         ON CONFLICT (user_id,object_key) WHERE object_key IS NOT NULL DO NOTHING`,
        [input.userId, row.media_type, row.object_key, row.manifest_hash]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
