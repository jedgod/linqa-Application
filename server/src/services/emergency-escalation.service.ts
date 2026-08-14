import type { Database } from "../db/pool.js";

export interface EscalationNotifier {
  notifyUser(input: { userId: string; emergencyEventId: string; tier: number }): Promise<void>;
  notifyStaff(input: { emergencyEventId: string; tier: number }): Promise<void>;
}

/** No emergency notification channel (SMS/push/paging) is configured in this environment. */
export class FailClosedEscalationNotifier implements EscalationNotifier {
  async notifyUser(): Promise<never> {
    throw new Error("Emergency notifier is not configured.");
  }
  async notifyStaff(): Promise<never> {
    throw new Error("Emergency notifier is not configured.");
  }
}

export class EmergencyEscalationService {
  constructor(
    private readonly db: Database,
    private readonly notifier: EscalationNotifier
  ) {}

  /**
   * Not part of the source pack — schedule() takes an already-existing
   * emergency_events row, but nothing in the pack ever created one. This is
   * the missing "start an emergency" entry point: inserts the event, then
   * schedules escalation exactly as before.
   */
  async trigger(input: { ownerUserId: string; triggeredFromDeviceId?: string }) {
    const result = await this.db.query(
      `INSERT INTO emergency_events(owner_user_id,triggered_from_device_id)
       VALUES($1,$2)
       RETURNING id,state,created_at`,
      [input.ownerUserId, input.triggeredFromDeviceId ?? null]
    );

    const event = result.rows[0];
    await this.schedule(event.id, input.ownerUserId);
    return event;
  }

  async schedule(eventId: string, ownerUserId: string) {
    const policy = await this.db.query(
      `SELECT *
       FROM emergency_escalation_policies_v2
       WHERE user_id=$1`,
      [ownerUserId]
    );

    const p = policy.rows[0] ?? {
      first_tier_wait_seconds: 30,
      second_tier_wait_seconds: 90,
      escalate_to_staff: false
    };

    const recipients = await this.db.query(
      `SELECT authorized_user_id
       FROM emergency_authorizations_v2
       WHERE owner_user_id=$1
         AND can_receive_sos=TRUE`,
      [ownerUserId]
    );

    for (const row of recipients.rows) {
      await this.db.query(
        `INSERT INTO emergency_escalation_steps_v2(
           emergency_event_id,tier,recipient_user_id,
           target_type,status,scheduled_for
         ) VALUES($1,1,$2,'TRUSTED_CONTACT','PENDING',
           now()+($3 || ' seconds')::interval
         )`,
        [eventId, row.authorized_user_id, p.first_tier_wait_seconds]
      );
    }

    if (p.escalate_to_staff === true) {
      await this.db.query(
        `INSERT INTO emergency_escalation_steps_v2(
           emergency_event_id,tier,target_type,status,scheduled_for
         ) VALUES($1,2,'STAFF','PENDING',
           now()+($2 || ' seconds')::interval
         )`,
        [eventId, p.second_tier_wait_seconds]
      );
    }
  }

  async processDue(limit = 100) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const due = await client.query(
        `SELECT *
         FROM emergency_escalation_steps_v2
         WHERE status='PENDING'
           AND scheduled_for<=now()
         ORDER BY scheduled_for
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      for (const row of due.rows) {
        try {
          if (row.target_type === "TRUSTED_CONTACT") {
            await this.notifier.notifyUser({
              userId: row.recipient_user_id,
              emergencyEventId: row.emergency_event_id,
              tier: row.tier
            });
          } else if (row.target_type === "STAFF") {
            await this.notifier.notifyStaff({
              emergencyEventId: row.emergency_event_id,
              tier: row.tier
            });
          }

          await client.query(
            `UPDATE emergency_escalation_steps_v2
             SET status='NOTIFIED',notified_at=now()
             WHERE id=$1`,
            [row.id]
          );
        } catch {
          await client.query(
            `UPDATE emergency_escalation_steps_v2
             SET status='FAILED'
             WHERE id=$1`,
            [row.id]
          );
        }
      }

      await client.query("COMMIT");
      return due.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
