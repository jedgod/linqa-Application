import type { Database } from "../db/pool.js";

export class TrustSafetyService {
  constructor(private readonly db: Database) {}

  async block(input: {
    blockerUserId: string;
    blockedUserId: string;
    reason?: string;
  }) {
    if (input.blockerUserId === input.blockedUserId) {
      throw new Error("cannot block self");
    }

    await this.db.query(
      `INSERT INTO blocked_users (
         blocker_user_id, blocked_user_id, reason
       ) VALUES ($1,$2,$3)
       ON CONFLICT (blocker_user_id, blocked_user_id)
       DO UPDATE SET reason = EXCLUDED.reason`,
      [input.blockerUserId, input.blockedUserId, input.reason ?? null]
    );

    await this.db.query(
      `UPDATE call_sessions c
       SET status = 'ENDED', ended_at = now()
       WHERE c.status IN ('CREATED','RINGING','ACTIVE')
         AND EXISTS (
           SELECT 1 FROM call_participants a
           JOIN call_participants b ON b.call_id = a.call_id
           WHERE a.call_id = c.id
             AND a.user_id = $1
             AND b.user_id = $2
         )`,
      [input.blockerUserId, input.blockedUserId]
    );
  }

  async submitReport(input: {
    reporterUserId: string;
    reportedUserId?: string;
    callId?: string;
    category:
      | "HARASSMENT"
      | "IMPERSONATION"
      | "THREATS"
      | "SCAM"
      | "SEXUAL_CONTENT"
      | "HATE"
      | "MINOR_SAFETY"
      | "OTHER";
    description: string;
    evidenceAttachmentId?: string;
  }) {
    if (input.description.trim().length < 10) {
      throw new Error("report description is too short");
    }

    const severity =
      input.category === "MINOR_SAFETY" || input.category === "THREATS"
        ? "CRITICAL"
        : "MEDIUM";

    const slaHours = severity === "CRITICAL" ? 1 : 24;

    if (input.evidenceAttachmentId !== undefined) {
      // Reuse the existing attachment upload pipeline rather than inventing
      // a second evidence-storage path: the reporter must already own a
      // completed upload before it can be attached as evidence.
      const attachment = await this.db.query(
        `SELECT id FROM attachment_uploads
         WHERE id = $1 AND owner_user_id = $2 AND status = 'COMPLETE'`,
        [input.evidenceAttachmentId, input.reporterUserId]
      );
      if (!attachment.rowCount) {
        throw new Error("evidence attachment not found or incomplete");
      }
    }

    const result = await this.db.query(
      `INSERT INTO safety_reports (
         reporter_user_id,
         reported_user_id,
         call_id,
         category,
         description,
         severity,
         sla_due_at,
         evidence_attachment_id
       ) VALUES ($1,$2,$3,$4,$5,$6,now() + ($7 || ' hours')::interval,$8)
       RETURNING id, status, severity, sla_due_at`,
      [
        input.reporterUserId,
        input.reportedUserId ?? null,
        input.callId ?? null,
        input.category,
        input.description.trim(),
        severity,
        slaHours,
        input.evidenceAttachmentId ?? null
      ]
    );

    return result.rows[0];
  }
}
