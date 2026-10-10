import type { Database } from "../db/pool.js";
import { ChatError, assertMember, withTransaction } from "./chat.service.js";

export const ATTACHMENT_KINDS = ["VIDEO", "VOICE", "DOCUMENT", "DESIGN", "AI_IMAGE", "LOCATION", "CONTACT", "EVENT", "MEETING"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const MIN_ENVELOPE = 32;
const MAX_ENVELOPE = 262_144;
/** A shared location can run for at most eight hours; the app offers shorter. */
export const MAX_LOCATION_SECONDS = 8 * 3600;

export type Attachment = { id: string; kind: AttachmentKind; vaultId: string | null; envelope: Buffer; createdAt: string; senderUserId: string };
export type LocationShareView = { id: string; state: "REQUESTED" | "SHARING" | "STOPPED" | "DECLINED"; ownerUserId: string; requestedBy: string; expiresAt: string | null; envelope: Buffer | null; createdAt: string };

const iso = (d: Date) => new Date(d).toISOString();

/**
 * Sealed attachments and location sharing for a conversation. Only members of the conversation can add or read
 * anything, ids a client chooses can never overwrite someone else's, and what is stored is opaque bytes.
 */
export class ThreadAttachmentService {
  constructor(private readonly db: Database) {}

  async storeMedia(input: { id: string; conversationId: string; userId: string; deviceId?: string; envelope: Buffer }): Promise<{ id: string }> {
    if (input.envelope.length < 32 || input.envelope.length > 25 * 1024 * 1024 + 40) throw new ChatError(422, "MEDIA_TOO_LARGE");
    return withTransaction(this.db, async client => {
      if (input.deviceId) { const active = await client.query("SELECT id FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE", [input.deviceId, input.userId]); if (!active.rowCount) throw new ChatError(401, "DEVICE_REQUIRED"); }
      await assertMember(client, input.userId, input.conversationId);
      await client.query("DELETE FROM conversation_media WHERE expires_at <= now()");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["conversation-media:" + input.userId]);
      const usage = await client.query("SELECT COALESCE(sum(octet_length(envelope)),0)::bigint AS bytes FROM conversation_media WHERE sender_user_id=$1 AND id<>$2", [input.userId, input.id]);
      if (Number(usage.rows[0]?.bytes ?? 0) + input.envelope.length > 128 * 1024 * 1024) throw new ChatError(413, "MEDIA_STORAGE_LIMIT");
      const result = await client.query(
        `INSERT INTO conversation_media(id,conversation_id,sender_user_id,envelope,expires_at)
         SELECT $1,$2,$3,$4, CASE WHEN disappear_after_seconds IS NULL THEN NULL ELSE now()+make_interval(secs=>disappear_after_seconds) END FROM conversations WHERE id=$2
         ON CONFLICT(id) DO NOTHING RETURNING id`, [input.id,input.conversationId,input.userId,input.envelope]);
      if (!result.rowCount) {
        const same = await client.query("SELECT 1 FROM conversation_media WHERE id=$1 AND conversation_id=$2 AND sender_user_id=$3 AND envelope=$4", [input.id,input.conversationId,input.userId,input.envelope]);
        if (!same.rowCount) throw new ChatError(409,"MEDIA_ID_TAKEN");
      }
      return { id: input.id };
    });
  }
  async readMedia(userId: string, conversationId: string, id: string): Promise<Buffer> {
    return withTransaction(this.db, async client => {
      await assertMember(client,userId,conversationId);
      const result = await client.query("SELECT envelope FROM conversation_media WHERE id=$1 AND conversation_id=$2 AND (expires_at IS NULL OR expires_at>now())", [id,conversationId]);
      if (!result.rowCount) throw new ChatError(404,"MEDIA_NOT_FOUND");
      return result.rows[0].envelope as Buffer;
    });
  }

  /** Idempotent: sending the same id again returns the original and stores nothing new. */
  async accept(input: { id: string; conversationId: string; userId: string; deviceId?: string | null; kind: AttachmentKind; vaultId?: string | null; envelope: Buffer }): Promise<{ id: string; accepted: true; duplicate: boolean }> {
    if (input.envelope.length < MIN_ENVELOPE || input.envelope.length > MAX_ENVELOPE) throw new ChatError(422, "ATTACHMENT_ENVELOPE_INVALID");
    return withTransaction(this.db, async (client) => {
      await assertMember(client, input.userId, input.conversationId);
      await client.query(`DELETE FROM thread_attachments WHERE conversation_id = $1 AND expires_at IS NOT NULL AND expires_at <= now()`, [input.conversationId]);
      const setting = await client.query(`SELECT disappear_after_seconds AS "seconds" FROM conversations WHERE id = $1`, [input.conversationId]);
      const seconds = (setting.rows[0] as { seconds: number | null } | undefined)?.seconds ?? null;
      const inserted = await client.query(
        `INSERT INTO thread_attachments (id, conversation_id, sender_user_id, sender_device_id, kind, vault_id, envelope, byte_length, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9::int IS NULL THEN NULL ELSE now() + make_interval(secs => $9::int) END)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [input.id, input.conversationId, input.userId, input.deviceId ?? null, input.kind, input.vaultId ?? null, input.envelope, input.envelope.length, seconds]
      );
      if (inserted.rowCount) return { id: input.id, accepted: true as const, duplicate: false };
      // The id is taken. It is a retry only if it is this sender's own attachment in this conversation.
      const mine = await client.query(`SELECT 1 FROM thread_attachments WHERE id = $1 AND sender_user_id = $2 AND conversation_id = $3 AND kind = $4 AND envelope = $5 AND vault_id IS NOT DISTINCT FROM $6`, [input.id, input.userId, input.conversationId, input.kind, input.envelope, input.vaultId ?? null]);
      if (!mine.rowCount) throw new ChatError(409, "ATTACHMENT_ID_TAKEN");
      return { id: input.id, accepted: true as const, duplicate: true };
    });
  }

  /** Newest first, expired ones left out. */
  async list(userId: string, conversationId: string, limit = 40): Promise<Attachment[]> {
    const n = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return withTransaction(this.db, async (client) => {
      await assertMember(client, userId, conversationId);
      const result = await client.query(
        `SELECT id, kind, vault_id AS "vaultId", envelope, created_at AS "createdAt", sender_user_id AS "senderUserId"
           FROM thread_attachments
          WHERE conversation_id = $1 AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC, id DESC LIMIT $2`,
        [conversationId, n]
      );
      return (result.rows as Array<Attachment & { createdAt: Date }>).map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
    });
  }

  /** Asks the other member to share their location. The request carries no coordinates. */
  async requestLocation(input: { id: string; conversationId: string; userId: string; peerUserId: string }): Promise<{ id: string; state: "REQUESTED" }> {
    if (input.peerUserId === input.userId) throw new ChatError(422, "LOCATION_REQUEST_SELF");
    return withTransaction(this.db, async (client) => {
      await assertMember(client, input.userId, input.conversationId);
      const peer = await client.query(`SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`, [input.conversationId, input.peerUserId]);
      if (!peer.rowCount) throw new ChatError(404, "CONVERSATION_NOT_FOUND");
      // One open request at a time per person, so a request cannot be repeated until it is answered.
      const open = await client.query(`SELECT 1 FROM location_shares WHERE conversation_id = $1 AND owner_user_id = $2 AND requested_by = $3 AND state = 'REQUESTED'`, [input.conversationId, input.peerUserId, input.userId]);
      if (open.rowCount) throw new ChatError(409, "LOCATION_REQUEST_PENDING");
      const inserted = await client.query(
        `INSERT INTO location_shares (id, conversation_id, owner_user_id, requested_by, state) VALUES ($1,$2,$3,$4,'REQUESTED') ON CONFLICT (id) DO NOTHING RETURNING id`,
        [input.id, input.conversationId, input.peerUserId, input.userId]
      );
      if (!inserted.rowCount) throw new ChatError(409, "LOCATION_SHARE_ID_TAKEN");
      return { id: input.id, state: "REQUESTED" as const };
    });
  }

  /** Only the person asked can answer. Accepting needs a sealed envelope and an end time within eight hours. */
  async answerLocation(input: { id: string; userId: string; accept: boolean; envelope?: Buffer; expiresAt?: Date }): Promise<{ id: string; state: "SHARING" | "DECLINED" }> {
    return withTransaction(this.db, async (client) => {
      const row = await client.query(`SELECT owner_user_id AS "owner", conversation_id AS "conversationId" FROM location_shares WHERE id = $1 AND state = 'REQUESTED' FOR UPDATE`, [input.id]);
      const share = row.rows[0] as { owner: string; conversationId: string } | undefined;
      // The same answer whether the share does not exist, is already answered, or belongs to someone else.
      if (!share || share.owner !== input.userId) throw new ChatError(404, "LOCATION_SHARE_NOT_FOUND");
      await assertMember(client, input.userId, share.conversationId);
      if (!input.accept) {
        await client.query(`UPDATE location_shares SET state = 'DECLINED', envelope = NULL, expires_at = NULL WHERE id = $1`, [input.id]);
        return { id: input.id, state: "DECLINED" as const };
      }
      if (!input.envelope || input.envelope.length < MIN_ENVELOPE || input.envelope.length > 65_536) throw new ChatError(422, "LOCATION_ENVELOPE_REQUIRED");
      const ms = input.expiresAt ? input.expiresAt.getTime() - Date.now() : Number.NaN;
      if (!(ms > 0) || ms > MAX_LOCATION_SECONDS * 1000) throw new ChatError(422, "LOCATION_EXPIRY_INVALID");
      await client.query(`UPDATE location_shares SET state = 'SHARING', envelope = $2, expires_at = $3 WHERE id = $1`, [input.id, input.envelope, input.expiresAt]);
      return { id: input.id, state: "SHARING" as const };
    });
  }

  async stopLocation(id: string, userId: string): Promise<{ id: string; state: "STOPPED" }> {
    const updated = await this.db.query(
      `UPDATE location_shares SET state = 'STOPPED', envelope = NULL, expires_at = NULL WHERE id = $1 AND owner_user_id = $2 AND state = 'SHARING'`, [id, userId]
    );
    if (updated.rowCount !== 1) throw new ChatError(404, "LOCATION_SHARE_NOT_FOUND");
    return { id, state: "STOPPED" };
  }

  /** Requests and shares in a conversation. Sharing that has run out is closed (and its envelope erased) before anything is returned. */
  async locationShares(userId: string, conversationId: string): Promise<LocationShareView[]> {
    return withTransaction(this.db, async (client) => {
      await assertMember(client, userId, conversationId);
      await client.query(`UPDATE location_shares SET state = 'STOPPED', envelope = NULL, expires_at = NULL WHERE conversation_id = $1 AND state = 'SHARING' AND expires_at <= now()`, [conversationId]);
      const result = await client.query(
        `SELECT id, state, owner_user_id AS "ownerUserId", requested_by AS "requestedBy", expires_at AS "expiresAt", envelope, created_at AS "createdAt"
           FROM location_shares WHERE conversation_id = $1 AND state IN ('REQUESTED','SHARING') ORDER BY created_at DESC LIMIT 20`, [conversationId]
      );
      return (result.rows as Array<LocationShareView & { createdAt: Date; expiresAt: Date | null }>).map((r) => ({ ...r, createdAt: iso(r.createdAt), expiresAt: r.expiresAt ? iso(r.expiresAt) : null }));
    });
  }
}
