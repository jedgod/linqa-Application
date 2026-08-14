import type { Database } from "../db/pool.js";

export class CallLifecycleRecorder {
  constructor(private readonly db: Database) {}

  async terminal(input: {
    eventId: string;
    callId: string;
    userId: string;
    peerUserId?: string;
    direction: "INCOMING" | "OUTGOING";
    callType: "AUDIO" | "VIDEO" | "SCREEN_SHARE";
    status: "MISSED" | "REJECTED" | "COMPLETED" | "FAILED" | "CANCELLED";
    startedAt?: Date;
    endedAt?: Date;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const idempotency = await client.query(
        `INSERT INTO lifecycle_idempotency(key,event_type)
         VALUES($1,'CALL_TERMINAL')
         ON CONFLICT(key) DO NOTHING`,
        [input.eventId]
      );

      if (idempotency.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { recorded: false, duplicate: true };
      }

      const durationSeconds =
        input.startedAt && input.endedAt
          ? Math.max(
              0,
              Math.floor(
                (input.endedAt.getTime() - input.startedAt.getTime()) / 1000
              )
            )
          : 0;

      await client.query(
        `INSERT INTO call_history(
           call_id,user_id,peer_user_id,direction,call_type,status,
           started_at,ended_at,duration_seconds
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.callId,
          input.userId,
          input.peerUserId ?? null,
          input.direction,
          input.callType,
          input.status,
          input.startedAt ?? null,
          input.endedAt ?? null,
          durationSeconds
        ]
      );

      await client.query("COMMIT");
      return { recorded: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class MediaLifecycleRecorder {
  constructor(private readonly db: Database) {}

  async completed(input: {
    eventId: string;
    userId: string;
    conversationId?: string;
    messageId?: string;
    mediaType: "IMAGE" | "VIDEO" | "VOICE_NOTE" | "DOCUMENT" | "LINK" | "FILE";
    objectKey: string;
    thumbnailObjectKey?: string;
    metadataCiphertext: Buffer;
    expiresAt?: Date;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const idempotency = await client.query(
        `INSERT INTO lifecycle_idempotency(key,event_type)
         VALUES($1,'MEDIA_COMPLETED')
         ON CONFLICT(key) DO NOTHING`,
        [input.eventId]
      );

      if (idempotency.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { recorded: false, duplicate: true };
      }

      await client.query(
        `INSERT INTO media_index(
           user_id,conversation_id,message_id,media_type,
           object_key,thumbnail_object_key,metadata_ciphertext,expires_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.userId,
          input.conversationId ?? null,
          input.messageId ?? null,
          input.mediaType,
          input.objectKey,
          input.thumbnailObjectKey ?? null,
          input.metadataCiphertext,
          input.expiresAt ?? null
        ]
      );

      await client.query("COMMIT");
      return { recorded: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
