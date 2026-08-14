import type { Database } from "../db/pool.js";

export class LocationSharingService {
  constructor(private readonly db: Database) {}

  async grant(input: {
    callId: string;
    userId: string;
    deviceId: string;
    mode: "CITY" | "APPROXIMATE" | "PRECISE";
    scope: "CALL_ONLY" | "MINUTES_15" | "HOUR_1";
    foregroundOnly: boolean;
  }) {
    const durationMinutes =
      input.scope === "MINUTES_15" ? 15 :
      input.scope === "HOUR_1" ? 60 :
      24 * 60;

    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    const participant = await this.db.query(
      `SELECT 1
       FROM call_participants p
       JOIN call_sessions c ON c.id = p.call_id
       WHERE p.call_id = $1
         AND p.user_id = $2
         AND p.device_id = $3
         AND c.status IN ('CREATED','RINGING','ACTIVE')`,
      [input.callId, input.userId, input.deviceId]
    );
    if (participant.rowCount !== 1) throw new Error("not a call participant");

    const result = await this.db.query(
      `INSERT INTO call_location_grants (
         call_id, user_id, device_id, mode, scope,
         foreground_only, status, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)
       ON CONFLICT (call_id, device_id)
       DO UPDATE SET
         mode = EXCLUDED.mode,
         scope = EXCLUDED.scope,
         foreground_only = EXCLUDED.foreground_only,
         status = 'ACTIVE',
         expires_at = EXCLUDED.expires_at,
         revoked_at = NULL
       RETURNING id, expires_at`,
      [
        input.callId,
        input.userId,
        input.deviceId,
        input.mode,
        input.scope,
        input.foregroundOnly,
        expiresAt
      ]
    );

    return result.rows[0];
  }

  async publishEncryptedLocation(input: {
    callId: string;
    deviceId: string;
    ciphertext: Buffer;
    capturedAt: Date;
    expiresAt: Date;
  }) {
    const grant = await this.db.query(
      `SELECT 1
       FROM call_location_grants g
       JOIN call_sessions c ON c.id = g.call_id
       WHERE g.call_id = $1
         AND g.device_id = $2
         AND g.status = 'ACTIVE'
         AND g.expires_at > now()
         AND c.status = 'ACTIVE'`,
      [input.callId, input.deviceId]
    );

    if (grant.rowCount !== 1) throw new Error("location sharing not authorized");
    if (input.ciphertext.length < 16) throw new Error("invalid encrypted location");
    if (input.expiresAt.getTime() <= Date.now()) throw new Error("location already expired");

    const result = await this.db.query(
      `INSERT INTO encrypted_location_events (
         call_id, sender_device_id, ciphertext, captured_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5)
       RETURNING sequence`,
      [
        input.callId,
        input.deviceId,
        input.ciphertext,
        input.capturedAt,
        input.expiresAt
      ]
    );

    return { sequence: Number(result.rows[0].sequence) };
  }

  // The publish/store side of call location sharing existed already
  // (publishEncryptedLocation), but nothing let the *other* call
  // participant read back what was published — there was no way to
  // actually show a shared location during a call. Requires the requester
  // to currently be a participant on the call, same as publish.
  async listEvents(input: {
    callId: string;
    userId: string;
    deviceId: string;
    afterSequence: number;
  }) {
    const participant = await this.db.query(
      `SELECT 1
       FROM call_participants
       WHERE call_id = $1
         AND user_id = $2
         AND device_id = $3`,
      [input.callId, input.userId, input.deviceId]
    );
    if (participant.rowCount !== 1) throw new Error("not a call participant");

    const result = await this.db.query(
      `SELECT sequence, sender_device_id, ciphertext, captured_at, expires_at
       FROM encrypted_location_events
       WHERE call_id = $1
         AND sequence > $2
         AND expires_at > now()
       ORDER BY sequence`,
      [input.callId, input.afterSequence]
    );
    return result.rows;
  }

  async revoke(callId: string, deviceId: string): Promise<void> {
    await this.db.query(
      `UPDATE call_location_grants
       SET status = 'REVOKED', revoked_at = now()
       WHERE call_id = $1
         AND device_id = $2
         AND status = 'ACTIVE'`,
      [callId, deviceId]
    );
  }
}
