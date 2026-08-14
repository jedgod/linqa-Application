import type { Database } from "../db/pool.js";

export class RecordedVideoService {
  constructor(private readonly db: Database) {}

  async create(input: {
    ownerUserId: string;
    ownerDeviceId: string;
    recipientUserId: string;
    attachmentId: string;
    ciphertextSize: number;
    durationSeconds: number;
    recordedAt: Date;
    retentionPolicy:
      | "VIEW_ONCE"
      | "DELETE_AFTER_VIEW"
      | "DELETE_24_HOURS"
      | "DELETE_7_DAYS"
      | "KEEP";
  }) {
    if (input.durationSeconds > 600) {
      throw new Error("recorded video duration exceeds limit");
    }

    const expiresAt =
      input.retentionPolicy === "DELETE_24_HOURS"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : input.retentionPolicy === "DELETE_7_DAYS"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null;

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      // The video bytes must already exist as a completed, owner-verified
      // attachment upload (real S3 object) — this binds the disclosure
      // metadata to bytes that actually landed in object storage, instead
      // of trusting a caller-supplied object key with nothing behind it.
      const upload = await client.query(
        `SELECT object_key, ciphertext_size
         FROM attachment_uploads
         WHERE id = $1 AND owner_user_id = $2 AND status = 'COMPLETE'
         FOR UPDATE`,
        [input.attachmentId, input.ownerUserId]
      );
      const uploadRow = upload.rows[0];
      if (!uploadRow) {
        throw new Error("recorded video attachment upload not found or incomplete");
      }
      if (Number(uploadRow.ciphertext_size) !== input.ciphertextSize) {
        throw new Error("recorded video size does not match the completed upload");
      }

      const result = await client.query(
        `INSERT INTO recorded_video_assets (
           owner_user_id,
           owner_device_id,
           recipient_user_id,
           object_key,
           ciphertext_size,
           duration_seconds,
           recorded_at,
           retention_policy,
           expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, created_at`,
        [
          input.ownerUserId,
          input.ownerDeviceId,
          input.recipientUserId,
          uploadRow.object_key,
          input.ciphertextSize,
          input.durationSeconds,
          input.recordedAt,
          input.retentionPolicy,
          expiresAt
        ]
      );

      await client.query("COMMIT");

      return {
        id: result.rows[0].id,
        recordedAt: input.recordedAt,
        disclosure: "RECORDED_VIDEO_NOT_LIVE",
        retentionPolicy: input.retentionPolicy,
        objectKey: uploadRow.object_key as string
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markViewed(assetId: string, recipientUserId: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT retention_policy, viewed_at
         FROM recorded_video_assets
         WHERE id = $1
           AND recipient_user_id = $2
           AND deletion_status = 'ACTIVE'
         FOR UPDATE`,
        [assetId, recipientUserId]
      );
      const row = result.rows[0];

      if (!row) throw new Error("recorded video unavailable");
      if (row.retention_policy === "VIEW_ONCE" && row.viewed_at) {
        throw new Error("recorded video already viewed");
      }

      await client.query(
        `UPDATE recorded_video_assets
         SET viewed_at = COALESCE(viewed_at, now()),
             deletion_status = CASE
               WHEN retention_policy IN ('VIEW_ONCE','DELETE_AFTER_VIEW')
               THEN 'QUEUED'
               ELSE deletion_status
             END
         WHERE id = $1`,
        [assetId]
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
