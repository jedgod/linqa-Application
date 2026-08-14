import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool.js";

export interface CdnSigner {
  sign(input: { cdnKey: string; expiresInSeconds: number }): Promise<string>;
}

/** No CDN signing key/provider is configured in this environment. */
export class FailClosedCdnSigner implements CdnSigner {
  async sign(): Promise<never> {
    throw new Error("CDN signer is not configured.");
  }
}

export class AttachmentCdnService {
  constructor(
    private readonly db: Database,
    private readonly signer: CdnSigner
  ) {}

  async createDelivery(input: {
    userId: string;
    conversationId: string;
    objectKey: string;
    encryptedSize: number;
    contentHash: Buffer;
  }) {
    const cdnKey = `attachments/${input.userId}/${randomUUID()}.bin`;

    const result = await this.db.query(
      `INSERT INTO attachment_delivery_v2(
         user_id,conversation_id,object_key,cdn_key,
         encrypted_size,content_hash
       ) VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,cdn_key,created_at`,
      [input.userId, input.conversationId, input.objectKey, cdnKey, input.encryptedSize, input.contentHash]
    );

    return result.rows[0];
  }

  async signedDownload(input: { requesterUserId: string; deliveryId: string }) {
    // FIX (2026-08-07 apply pass): the pack joined a nonexistent
    // chat_members(thread_id) table. The real membership table
    // (009_gap_closure.sql) is conversation_members(conversation_id).
    const result = await this.db.query(
      `SELECT a.cdn_key
       FROM attachment_delivery_v2 a
       JOIN conversation_members m ON m.conversation_id=a.conversation_id
       WHERE a.id=$1 AND m.user_id=$2`,
      [input.deliveryId, input.requesterUserId]
    );

    const row = result.rows[0];
    if (!row) throw new Error("attachment access denied");

    return {
      url: await this.signer.sign({ cdnKey: row.cdn_key, expiresInSeconds: 60 })
    };
  }
}
