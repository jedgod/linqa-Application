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

  /** Frees the parts of an upload that will never be completed. Safe to repeat. */
  abortMultipartUpload(objectKey: string, uploadId: string): Promise<void>;

  deleteObject(objectKey: string): Promise<void>;
}

export type UploadPurpose = "GENERAL" | "STATUS_VIDEO";

/**
 * Checks the parts list a client sends to complete an upload: exactly the declared count, numbered 1..N once each, with a plausible
 * ETag. An ETag is the store's receipt for a part, not proof of what is in it: integrity comes from the authenticated chunk format
 * and manifest check on the phones. The ETag syntax check only keeps junk (and anything XML-shaped) out of the completion request.
 */
export function validateMultipartParts(parts: Array<{ partNumber: number; etag: string }>, expectedCount: number) {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 10_000 || parts.length !== expectedCount) throw new Error("INVALID_PART_COUNT");
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  ordered.forEach((part, i) => {
    if (part.partNumber !== i + 1 || !/^"?[A-Za-z0-9+/=_-]{16,128}"?$/.test(part.etag)) throw new Error("INVALID_PART_METADATA");
  });
  return ordered;
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
    purpose?: UploadPurpose;
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
         multipart_upload_id,
         purpose,
         status,
         expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'UPLOADING',now() + interval '24 hours')
       RETURNING id`,
      [
        input.userId,
        input.deviceId,
        objectKey,
        input.mediaType,
        input.ciphertextSize,
        input.chunkCount,
        input.manifestHash,
        upload.uploadId,
        input.purpose ?? "GENERAL"
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
      `SELECT object_key, chunk_count, status, multipart_upload_id
       FROM attachment_uploads
       WHERE id = $1 AND owner_user_id = $2`,
      [attachmentId, userId]
    );
    const row = result.rows[0];

    if (!row || row.status !== "UPLOADING") {
      throw new Error("upload not available");
    }
    // The multipart session is the one the server created for this attachment; a client may not point a part at another session.
    if (!row.multipart_upload_id || row.multipart_upload_id !== uploadId) throw new Error("upload session mismatch");
    if (partNumber < 1 || partNumber > row.chunk_count) {
      throw new Error("invalid part number");
    }

    return this.storage.signPartUpload({
      objectKey: row.object_key,
      uploadId: row.multipart_upload_id,
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
        `SELECT object_key, chunk_count, status, media_type, manifest_hash, multipart_upload_id
         FROM attachment_uploads
         WHERE id = $1 AND owner_user_id = $2
         FOR UPDATE`,
        [input.attachmentId, input.userId]
      );
      const row = result.rows[0];

      if (!row || row.status !== "UPLOADING") {
        throw new Error("upload cannot be completed");
      }
      if (!row.multipart_upload_id || row.multipart_upload_id !== input.uploadId) throw new Error("upload session mismatch");
      const parts = validateMultipartParts(input.parts, row.chunk_count);

      await this.storage.completeMultipartUpload({
        objectKey: row.object_key,
        uploadId: row.multipart_upload_id,
        parts
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

  /**
   * The owner cancels an upload that has not completed: the stored parts are freed and the attachment can never be completed. If the
   * store cannot be reached the attachment is still closed to the owner and a cleanup job frees the parts later.
   */
  async abort(userId: string, attachmentId: string): Promise<void> {
    const found = await this.db.query(
      `UPDATE attachment_uploads SET status = 'DELETED', deleted_at = now()
        WHERE id = $1 AND owner_user_id = $2 AND status IN ('CREATED','UPLOADING')
        RETURNING object_key, multipart_upload_id`,
      [attachmentId, userId]
    );
    const row = found.rows[0];
    if (!row) throw new Error("upload not available");
    if (!row.multipart_upload_id) return;
    try {
      await this.storage.abortMultipartUpload(row.object_key, row.multipart_upload_id);
    } catch {
      await this.db.query(
        `INSERT INTO status_video_cleanup_jobs (attachment_id, action, object_key, multipart_upload_id)
         VALUES ($1,'ABORT_MULTIPART',$2,$3) ON CONFLICT DO NOTHING`,
        [attachmentId, row.object_key, row.multipart_upload_id]
      );
    }
  }
}
