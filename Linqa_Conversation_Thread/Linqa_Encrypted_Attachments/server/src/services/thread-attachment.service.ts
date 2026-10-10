import type { Database } from "../db/pool.js";

export type AttachmentKind =
  | "VIDEO"
  | "VOICE"
  | "DOCUMENT"
  | "DESIGN"
  | "AI_IMAGE"
  | "LOCATION"
  | "EVENT"
  | "MEETING";

export class ThreadAttachmentService {
  constructor(private readonly db: Database) {}

  async accept(input: {
    id: string;
    conversationId: string;
    userId: string;
    deviceId: string;
    kind: AttachmentKind;
    vaultId?: string;
    envelope: Buffer;
  }) {
    await this.requireMember(input.userId, input.conversationId);
    if (input.envelope.length < 32) throw new Error("ATTACHMENT_ENVELOPE_INVALID");
    await this.db.query(
      `INSERT INTO thread_attachments(
         id,conversation_id,sender_user_id,sender_device_id,kind,vault_id,envelope,byte_length
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO NOTHING`,
      [
        input.id,
        input.conversationId,
        input.userId,
        input.deviceId,
        input.kind,
        input.vaultId ?? null,
        input.envelope,
        input.envelope.length,
      ],
    );
    return { id: input.id, accepted: true };
  }

  async list(userId: string, conversationId: string, limit = 40) {
    await this.requireMember(userId, conversationId);
    const result = await this.db.query(
      `SELECT id,kind,vault_id,envelope,byte_length,created_at,sender_user_id
         FROM thread_attachments
        WHERE conversation_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [conversationId, limit],
    );
    return result.rows;
  }

  async requestLocation(input: {
    id: string;
    conversationId: string;
    userId: string;
    peerUserId: string;
  }) {
    await this.requireMember(input.userId, input.conversationId);
    await this.db.query(
      `INSERT INTO location_shares(id,conversation_id,owner_user_id,state,requested_by)
       VALUES($1,$2,$3,'REQUESTED',$4)`,
      [input.id, input.conversationId, input.peerUserId, input.userId],
    );
    return { id: input.id, state: "REQUESTED" };
  }

  async answerLocation(input: {
    id: string;
    userId: string;
    accept: boolean;
    envelope?: Buffer;
    expiresAt?: Date;
  }) {
    const row = await this.db.query(
      `SELECT owner_user_id,conversation_id FROM location_shares WHERE id=$1 AND state='REQUESTED'`,
      [input.id],
    );
    if (row.rowCount !== 1 || row.rows[0].owner_user_id !== input.userId) {
      throw new Error("LOCATION_SHARE_NOT_YOURS");
    }
    if (!input.accept) {
      await this.db.query(`UPDATE location_shares SET state='DECLINED' WHERE id=$1`, [input.id]);
      return { id: input.id, state: "DECLINED" };
    }
    if (!input.envelope || input.envelope.length < 32) throw new Error("LOCATION_ENVELOPE_REQUIRED");
    await this.db.query(
      `UPDATE location_shares
          SET state='SHARING', envelope=$2, expires_at=$3
        WHERE id=$1`,
      [input.id, input.envelope, input.expiresAt ?? null],
    );
    return { id: input.id, state: "SHARING" };
  }

  async stopLocation(id: string, userId: string) {
    const updated = await this.db.query(
      `UPDATE location_shares SET state='STOPPED', envelope=NULL
        WHERE id=$1 AND owner_user_id=$2 AND state='SHARING'`,
      [id, userId],
    );
    if (updated.rowCount !== 1) throw new Error("LOCATION_SHARE_NOT_ACTIVE");
    return { id, state: "STOPPED" };
  }

  private async requireMember(userId: string, conversationId: string) {
    const result = await this.db.query(
      `SELECT 1 FROM chat_members WHERE thread_id=$1 AND user_id=$2`,
      [conversationId, userId],
    );
    if (result.rowCount !== 1) throw new Error("conversation access denied");
  }
}
