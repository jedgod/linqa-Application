import type { Database } from "../db/pool.js";

export class SignalingService {
  constructor(private readonly db: Database) {}

  async append(input: {
    callId: string;
    senderDeviceId: string;
    recipientDeviceId: string;
    sequence: number;
    eventType:
      | "OFFER"
      | "ANSWER"
      | "ICE_CANDIDATE"
      | "ICE_COMPLETE"
      | "CALL_ACCEPTED"
      | "CALL_REJECTED"
      | "CALL_ENDED"
      | "RESUME";
    ciphertext: Buffer;
    expiresAt: Date;
  }) {
    if (input.sequence <= 0) throw new Error("invalid signaling sequence");
    if (input.ciphertext.length < 16) throw new Error("invalid signaling ciphertext");

    const participants = await this.db.query(
      `SELECT device_id
       FROM call_participants
       WHERE call_id = $1
         AND device_id = ANY($2::uuid[])`,
      [input.callId, [input.senderDeviceId, input.recipientDeviceId]]
    );

    if (participants.rowCount !== 2) {
      throw new Error("signaling participant mismatch");
    }

    const result = await this.db.query(
      `INSERT INTO signaling_events (
         call_id,
         sender_device_id,
         recipient_device_id,
         sequence,
         event_type,
         ciphertext,
         expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
      [
        input.callId,
        input.senderDeviceId,
        input.recipientDeviceId,
        input.sequence,
        input.eventType,
        input.ciphertext,
        input.expiresAt
      ]
    );

    return result.rows[0];
  }

  async pull(input: {
    callId: string;
    recipientDeviceId: string;
    afterSequence: number;
  }) {
    const result = await this.db.query(
      `SELECT id, sender_device_id, sequence, event_type, ciphertext, created_at
       FROM signaling_events
       WHERE call_id = $1
         AND recipient_device_id = $2
         AND sequence > $3
         AND expires_at > now()
       ORDER BY sequence ASC`,
      [input.callId, input.recipientDeviceId, input.afterSequence]
    );

    return result.rows;
  }
}
