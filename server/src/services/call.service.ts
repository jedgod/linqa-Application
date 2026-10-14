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

      // Ownership, not just liveness: the previous check only asked whether
      // both device ids were ACTIVE, so any active device id could be paired
      // with any user id and written into call_participants as that user's
      // device. Bind each device to the user it is claimed for.
      const activeDevices = await client.query(
        `SELECT id, user_id
         FROM devices
         WHERE id = ANY($1::uuid[])
           AND status = 'ACTIVE'`,
        [[input.initiatorDeviceId, input.recipientDeviceId]]
      );
      const ownerOf = new Map<string, string>(
        (activeDevices.rows as Array<{ id: string; user_id: string }>).map((row) => [row.id, row.user_id])
      );
      if (ownerOf.get(input.initiatorDeviceId) !== input.initiatorUserId) {
        throw new Error("inactive call participant");
      }
      if (ownerOf.get(input.recipientDeviceId) !== input.recipientUserId) {
        throw new Error("inactive call participant");
      }
      if (input.initiatorDeviceId === input.recipientDeviceId) {
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

  /**
   * Ends a call and writes each person's history row.
   *
   * `reason` is only honoured before the call is answered: the callee declining is REJECTED, a connection that never came up is
   * FAILED. Left out, an unanswered call is CANCELLED for the caller and MISSED for the callee, and an answered one COMPLETED.
   * The state machine is one-way: a call that has already ended cannot be ended again, so a late "end" from the other phone is refused.
   */
  async end(callId: string, deviceId: string, reason?: "REJECTED" | "FAILED"): Promise<void> {
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

      const answered = row.status === "ACTIVE";
      const terminalStatus = answered ? "COMPLETED" : reason ?? "CANCELLED";
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
           CASE WHEN $3::text = 'CANCELLED' AND participant.role = 'CALLEE' THEN 'MISSED' ELSE $3::text END,
           COALESCE($4::timestamptz,$5::timestamptz),
           now(),
           GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE($4::timestamptz,$5::timestamptz)))::integer)
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

  /**
   * Picks the device a call to `userId` should ring.
   *
   * The client cannot supply `recipientDeviceId`: device ids are not exposed
   * to peers (enumerating someone's devices is a privacy leak), so resolution
   * happens here. Most-recently-seen active device wins, which is the one the
   * user is most likely holding.
   */
  async resolveCallableDevice(userId: string): Promise<string | null> {
    const result = await this.db.query(
      `SELECT id FROM devices
       WHERE user_id = $1 AND status = 'ACTIVE'
       ORDER BY last_seen_at DESC NULLS LAST, registered_at DESC
       LIMIT 1`,
      [userId]
    );
    return (result.rows[0] as { id: string } | undefined)?.id ?? null;
  }

  /**
   * Upcoming scheduled calls the user is party to, as organizer or invitee.
   * Still-SCHEDULED entries that are upcoming or whose join window is still open
   * (a call stays listed for an hour after its start): this backs a "what's next"
   * view, not an audit log.
   */
  async listScheduled(userId: string, limit = 50) {
    const result = await this.db.query(
      `SELECT
         sc.id,
         sc.call_type        AS "callType",
         sc.privacy_mode     AS "privacyMode",
         sc.scheduled_for    AS "scheduledFor",
         sc.status,
         sc.created_at       AS "createdAt",
         (sc.organizer_user_id = $1) AS "isOrganizer",
         sc.organizer_user_id AS "organizerUserId",
         sc.participant_user_ids AS "participantUserIds",
         -- The join window belongs to the server: opens 10 minutes before the start and closes an hour after.
         (now() >= sc.scheduled_for - interval '10 minutes' AND now() <= sc.scheduled_for + interval '60 minutes') AS "joinable",
         COALESCE(organizer.display_name, 'Linqa user') AS "organizerName",
         COALESCE(
           (SELECT array_agg(COALESCE(p.display_name, 'Linqa user') ORDER BY p.display_name)
            FROM user_profiles p
            WHERE p.user_id = ANY(sc.participant_user_ids)),
           '{}'
         ) AS "participantNames",
         cardinality(sc.participant_user_ids) AS "participantCount"
       FROM scheduled_calls sc
       LEFT JOIN user_profiles organizer ON organizer.user_id = sc.organizer_user_id
       WHERE sc.status = 'SCHEDULED'
         AND sc.scheduled_for > now() - interval '60 minutes'
         AND (sc.organizer_user_id = $1 OR $1 = ANY(sc.participant_user_ids))
       ORDER BY sc.scheduled_for ASC
       LIMIT $2`,
      [userId, Math.max(1, Math.min(limit, 200))]
    );
    return result.rows;
  }

  /**
   * Cancels a scheduled call. Only the organizer may cancel, and only while it
   * is still SCHEDULED -- returns false rather than throwing so the route can
   * answer 404 without leaking whether the id exists.
   */
  async cancelScheduled(scheduledCallId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE scheduled_calls
       SET status = 'CANCELLED'
       WHERE id = $1 AND organizer_user_id = $2 AND status = 'SCHEDULED'`,
      [scheduledCallId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
