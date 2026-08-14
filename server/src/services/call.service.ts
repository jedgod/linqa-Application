import type { Database } from "../db/pool.js";

export class CallService {
  constructor(private readonly db: Database) {}

  async create(input: {
    initiatorUserId: string;
    initiatorDeviceId: string;
    recipientUserId: string;
    recipientDeviceId: string;
    callType: "AUDIO" | "VIDEO" | "SCREEN_SHARE";
    mode: "LIVE" | "RECORDED_RESPONSE";
    privacyMode: "STANDARD" | "RELAY_ONLY";
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const activeDevices = await client.query(
        `SELECT id
         FROM devices
         WHERE id = ANY($1::uuid[])
           AND status = 'ACTIVE'`,
        [[input.initiatorDeviceId, input.recipientDeviceId]]
      );
      if (activeDevices.rowCount !== 2) {
        throw new Error("inactive call participant");
      }

      const call = await client.query(
        `INSERT INTO call_sessions (
           initiator_user_id,
           initiator_device_id,
           call_type,
           mode,
           status,
           privacy_mode
         ) VALUES ($1,$2,$3,$4,'CREATED',$5)
         RETURNING id, created_at`,
        [
          input.initiatorUserId,
          input.initiatorDeviceId,
          input.callType,
          input.mode,
          input.privacyMode
        ]
      );

      const callId = call.rows[0].id as string;

      await client.query(
        `INSERT INTO call_participants (call_id, user_id, device_id, role)
         VALUES
           ($1,$2,$3,'CALLER'),
           ($1,$4,$5,'CALLEE')`,
        [
          callId,
          input.initiatorUserId,
          input.initiatorDeviceId,
          input.recipientUserId,
          input.recipientDeviceId
        ]
      );

      await client.query("COMMIT");
      return {
        callId,
        createdAt: call.rows[0].created_at,
        mode: input.mode,
        privacyMode: input.privacyMode
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async end(callId: string, deviceId: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const call = await client.query(
        `SELECT c.status,c.call_type,c.started_at,c.created_at
         FROM call_sessions c
         WHERE c.id=$1
           AND c.status IN ('CREATED','RINGING','ACTIVE')
           AND EXISTS (
             SELECT 1 FROM call_participants p
             WHERE p.call_id=c.id AND p.device_id=$2
           )
         FOR UPDATE`,
        [callId, deviceId]
      );
      const row = call.rows[0];
      if (!row) throw new Error("call cannot be ended");

      const terminalStatus = row.status === "ACTIVE" ? "COMPLETED" : "CANCELLED";
      await client.query(
        `UPDATE call_sessions
         SET status='ENDED',ended_at=now()
         WHERE id=$1`,
        [callId]
      );
      await client.query(
        `INSERT INTO call_history(
           call_id,user_id,peer_user_id,direction,call_type,status,
           started_at,ended_at,duration_seconds
         )
         SELECT
           $1,
           participant.user_id,
           peer.user_id,
           CASE participant.role WHEN 'CALLER' THEN 'OUTGOING' ELSE 'INCOMING' END,
           $2,
           $3,
           COALESCE($4,$5),
           now(),
           GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE($4,$5)))::integer)
         FROM call_participants participant
         LEFT JOIN call_participants peer
           ON peer.call_id=participant.call_id AND peer.device_id<>participant.device_id
         WHERE participant.call_id=$1
         ON CONFLICT (call_id,user_id) WHERE call_id IS NOT NULL DO NOTHING`,
        [callId, row.call_type, terminalStatus, row.started_at, row.created_at]
      );
      await client.query(
        `UPDATE call_location_grants
         SET status='REVOKED',revoked_at=now()
         WHERE call_id=$1 AND status='ACTIVE'`,
        [callId]
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
