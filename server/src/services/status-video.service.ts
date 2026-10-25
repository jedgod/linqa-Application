import type { Database } from "../db/pool.js";
import type { ObjectStorage } from "./attachment.service.js";

export type StatusVideoErrorCode =
  | "invalid_duration"
  | "invalid_audience"
  | "invalid_recipients"
  | "invalid_upload"
  | "not_found";

export class StatusVideoError extends Error {
  constructor(public readonly code: StatusVideoErrorCode) {
    super(code);
    this.name = "StatusVideoError";
  }
}

export const MAX_STATUS_VIDEO_SECONDS = 30 * 60;
export const MAX_STATUS_VIDEO_DEVICES = 200;
export const DEFAULT_STATUS_VIDEO_HOURS = 24;
export const MAX_STATUS_VIDEO_HOURS = 24 * 7;
const DOWNLOAD_LINK_SECONDS = 120;

export interface SealedRecipient {
  userId: string;
  deviceId: string;
  /** Produced on the owner's phone and opaque here; only this device can open it. */
  sealedKey: string;
}

/**
 * Encrypted video posts to a person's status.
 *
 * The server never sees a key or a frame: the video is a completed attachment upload (ciphertext), and each allowed device holds a
 * sealed bundle only it can open. This service decides WHO may fetch the ciphertext and WHEN it disappears; it cannot decide
 * what is in it.
 */
export class StatusVideoService {
  constructor(private readonly db: Database, private readonly storage: ObjectStorage) {}

  /**
   * Two people are "connected" when either has the other as a contact or they share a conversation they are both still in, and
   * neither has blocked the other. This is the same notion the profile-photo route uses, minus call history (a call alone should
   * not make someone part of a status audience). Evaluated again on every read, so a block takes effect immediately.
   */
  private static readonly CONNECTED_SQL = `
    NOT EXISTS (SELECT 1 FROM blocked_users b
                 WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = $2) OR (b.blocker_user_id = $2 AND b.blocked_user_id = $1))
    AND (EXISTS (SELECT 1 FROM chat_contacts cc
                  WHERE (cc.owner_user_id = $1 AND cc.contact_user_id = $2) OR (cc.owner_user_id = $2 AND cc.contact_user_id = $1))
      OR EXISTS (SELECT 1 FROM conversation_members mine JOIN conversation_members peer ON peer.conversation_id = mine.conversation_id
                  WHERE mine.user_id = $1 AND mine.removed_at IS NULL AND peer.user_id = $2 AND peer.removed_at IS NULL))`;

  async create(input: {
    ownerUserId: string;
    ownerDeviceId: string;
    attachmentId: string;
    kind: "VIDEO" | "PODCAST";
    durationSeconds: number;
    ciphertextSize: number;
    expiresInHours?: number | undefined;
    recipients: SealedRecipient[];
  }): Promise<{ id: string; expiresAt: string; deliveredToDevices: number }> {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > MAX_STATUS_VIDEO_SECONDS) {
      throw new StatusVideoError("invalid_duration");
    }
    const hours = input.expiresInHours ?? DEFAULT_STATUS_VIDEO_HOURS;
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_STATUS_VIDEO_HOURS) throw new StatusVideoError("invalid_recipients");
    const recipients = input.recipients;
    if (recipients.length < 1 || recipients.length > MAX_STATUS_VIDEO_DEVICES) throw new StatusVideoError("invalid_recipients");
    if (new Set(recipients.map((r) => r.deviceId)).size !== recipients.length) throw new StatusVideoError("invalid_recipients");
    for (const r of recipients) if (!r.sealedKey || r.sealedKey.length > 65536) throw new StatusVideoError("invalid_recipients");

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      // The bytes must already be a completed, owner-verified upload of exactly this size. One upload backs at most one post.
      const upload = await client.query(
        `SELECT ciphertext_size, media_type FROM attachment_uploads WHERE id = $1 AND owner_user_id = $2 AND status = 'COMPLETE' FOR UPDATE`,
        [input.attachmentId, input.ownerUserId]
      );
      const u = upload.rows[0];
      if (!u || Number(u.ciphertext_size) !== input.ciphertextSize || u.media_type !== "VIDEO") throw new StatusVideoError("invalid_upload");

      // Every device must be an ACTIVE device of the user it is listed under; a recipient other than the owner must be connected.
      const byUser = new Map<string, string[]>();
      for (const r of recipients) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.deviceId]);
      for (const [userId, deviceIds] of byUser) {
        const devices = await client.query(
          `SELECT d.id FROM devices d JOIN users u ON u.id = d.user_id
            WHERE d.user_id = $1 AND d.id = ANY($2::uuid[]) AND d.status = 'ACTIVE' AND d.revoked_at IS NULL AND u.status = 'ACTIVE'`,
          [userId, deviceIds]
        );
        if (devices.rowCount !== deviceIds.length) throw new StatusVideoError("invalid_audience");
        if (userId !== input.ownerUserId) {
          const connected = await client.query(`SELECT 1 WHERE ${StatusVideoService.CONNECTED_SQL}`, [input.ownerUserId, userId]);
          if (!connected.rowCount) throw new StatusVideoError("invalid_audience");
        }
      }

      const post = await client.query(
        `INSERT INTO status_video_posts (owner_user_id, owner_device_id, attachment_id, kind, duration_seconds, ciphertext_size, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7))
         RETURNING id, expires_at`,
        [input.ownerUserId, input.ownerDeviceId, input.attachmentId, input.kind, input.durationSeconds, input.ciphertextSize, hours]
      );
      const id = post.rows[0].id as string;
      for (const r of recipients) {
        await client.query(
          `INSERT INTO status_video_recipients (post_id, recipient_user_id, recipient_device_id, sealed_key) VALUES ($1,$2,$3,$4)`,
          [id, r.userId, r.deviceId, r.sealedKey]
        );
      }
      await client.query("COMMIT");
      return { id, expiresAt: new Date(post.rows[0].expires_at).toISOString(), deliveredToDevices: recipients.length };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // A second post for the same upload hits the UNIQUE constraint: report it as an invalid upload, not a server fault.
      if ((error as { code?: string }).code === "23505") throw new StatusVideoError("invalid_upload");
      throw error;
    } finally {
      client.release();
    }
  }

  /** What this device may open right now: not expired, not deleted, not from someone who is now blocked either way. */
  async feed(userId: string, deviceId: string) {
    const result = await this.db.query(
      `SELECT p.id, p.attachment_id, p.owner_user_id, p.kind, p.duration_seconds, p.ciphertext_size, p.created_at, p.expires_at, r.sealed_key, r.viewed_at
         FROM status_video_recipients r JOIN status_video_posts p ON p.id = r.post_id
        WHERE r.recipient_device_id = $1 AND r.recipient_user_id = $2 AND p.deleted_at IS NULL AND p.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM blocked_users b
                           WHERE (b.blocker_user_id = $2 AND b.blocked_user_id = p.owner_user_id) OR (b.blocker_user_id = p.owner_user_id AND b.blocked_user_id = $2))
        ORDER BY p.created_at DESC LIMIT 100`,
      [deviceId, userId]
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      // Not a storage location: it only lets the viewer check that the sealed bundle was made for THIS upload.
      attachmentId: row.attachment_id as string,
      ownerUserId: row.owner_user_id as string,
      kind: row.kind as "VIDEO" | "PODCAST",
      durationSeconds: row.duration_seconds as number,
      ciphertextSize: Number(row.ciphertext_size),
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      sealedKey: row.sealed_key as string,
      viewedAt: row.viewed_at ? new Date(row.viewed_at).toISOString() : null
    }));
  }

  /** A short-lived link to the ciphertext, for a device that holds a bundle for this post. Anyone else gets the same "not_found". */
  async signDownload(userId: string, deviceId: string, postId: string) {
    const result = await this.db.query(
      `SELECT a.object_key, p.ciphertext_size
         FROM status_video_recipients r
         JOIN status_video_posts p ON p.id = r.post_id
         JOIN attachment_uploads a ON a.id = p.attachment_id AND a.status = 'COMPLETE'
        WHERE r.post_id = $1 AND r.recipient_device_id = $2 AND r.recipient_user_id = $3
          AND p.deleted_at IS NULL AND p.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM blocked_users b
                           WHERE (b.blocker_user_id = $3 AND b.blocked_user_id = p.owner_user_id) OR (b.blocker_user_id = p.owner_user_id AND b.blocked_user_id = $3))`,
      [postId, deviceId, userId]
    );
    const row = result.rows[0];
    if (!row) throw new StatusVideoError("not_found");
    const { url } = await this.storage.signDownload({ objectKey: row.object_key as string, expiresInSeconds: DOWNLOAD_LINK_SECONDS });
    return { url, ciphertextSize: Number(row.ciphertext_size), expiresInSeconds: DOWNLOAD_LINK_SECONDS };
  }

  async markViewed(userId: string, deviceId: string, postId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE status_video_recipients r SET viewed_at = COALESCE(r.viewed_at, now())
         FROM status_video_posts p
        WHERE r.post_id = $1 AND r.recipient_device_id = $2 AND r.recipient_user_id = $3 AND p.id = r.post_id
          AND p.deleted_at IS NULL AND p.expires_at > now()`,
      [postId, deviceId, userId]
    );
    if (!result.rowCount) throw new StatusVideoError("not_found");
  }

  /** The owner's own posts, with how many devices it was delivered to and how many have viewed it. */
  async mine(ownerUserId: string) {
    const result = await this.db.query(
      `SELECT p.id, p.kind, p.duration_seconds, p.created_at, p.expires_at,
              count(r.*)::int AS delivered, count(r.viewed_at)::int AS viewed
         FROM status_video_posts p LEFT JOIN status_video_recipients r ON r.post_id = p.id
        WHERE p.owner_user_id = $1 AND p.deleted_at IS NULL AND p.expires_at > now()
        GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`,
      [ownerUserId]
    );
    return result.rows.map((row) => ({
      id: row.id as string, kind: row.kind as string, durationSeconds: row.duration_seconds as number,
      createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
      deliveredToDevices: row.delivered as number, viewedByDevices: row.viewed as number
    }));
  }

  /** Owner takes a post down: nobody can fetch it again, the ciphertext is deleted, and the audit row stays. */
  async remove(ownerUserId: string, postId: string): Promise<void> {
    const found = await this.db.query(`SELECT 1 FROM status_video_posts WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`, [postId, ownerUserId]);
    if (!found.rowCount) throw new StatusVideoError("not_found");
    await this.retire([postId]);
  }

  /** Retention job: take down every post whose time is up. Returns how many. */
  async expireDue(limit = 200): Promise<number> {
    const due = await this.db.query(`SELECT id FROM status_video_posts WHERE deleted_at IS NULL AND expires_at <= now() ORDER BY expires_at LIMIT $1`, [limit]);
    const ids = due.rows.map((r) => r.id as string);
    if (ids.length) await this.retire(ids);
    return ids.length;
  }

  /**
   * Revoke access first (drop every sealed key, mark deleted), then delete the stored ciphertext. If the object delete fails the
   * post is already unreachable, and the upload row is left for the attachment cleanup to retry.
   *
   * A post under an active retention override (safety report, legal hold, security incident: the same `retention_overrides` the
   * other retention jobs honour, with resource type STATUS_VIDEO) is still taken down for everyone, so no one can watch it, but its
   * ciphertext is kept for the investigation.
   */
  private async retire(postIds: string[]): Promise<void> {
    const client = await this.db.connect();
    let keys: string[] = [];
    try {
      await client.query("BEGIN");
      const posts = await client.query(
        `UPDATE status_video_posts p SET deleted_at = now()
          WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL
          RETURNING p.id, p.attachment_id,
            EXISTS (SELECT 1 FROM retention_overrides o
                     WHERE o.resource_type = 'STATUS_VIDEO' AND o.resource_id = p.id AND o.released_at IS NULL
                       AND (o.expires_at IS NULL OR o.expires_at > now())) AS held`,
        [postIds]
      );
      await client.query(`DELETE FROM status_video_recipients WHERE post_id = ANY($1::uuid[])`, [postIds]);
      const attachmentIds = posts.rows.filter((r) => !r.held).map((r) => r.attachment_id as string);
      if (attachmentIds.length) {
        const uploads = await client.query(
          `UPDATE attachment_uploads SET status = 'DELETED', deleted_at = now() WHERE id = ANY($1::uuid[]) RETURNING object_key`,
          [attachmentIds]
        );
        keys = uploads.rows.map((r) => r.object_key as string);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    for (const key of keys) await this.storage.deleteObject(key).catch(() => undefined);
  }
}
