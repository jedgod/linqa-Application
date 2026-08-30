import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";
import type { SupportReplyDelivery } from "./support-reply-delivery.adapter.js";

// support_cases_v2 has no "ASSIGNED"/"QUEUED" step and no notion of an
// archived-but-reopenable state -- CLOSED is the only state a case can't be
// replied into. RESOLVED cases can still get a reply (e.g. a client
// follow-up before the case is formally closed).
export function canReplyToCase(state: string): boolean {
  return state !== "CLOSED";
}

class OpsHttpError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly details?: unknown) {
    super(message);
  }
}

export class CaseMessagesService {
  private readonly support: SupportOperationsService;

  constructor(
    private readonly db: Database,
    private readonly delivery: SupportReplyDelivery
  ) {
    this.support = new SupportOperationsService(db);
  }

  async list(caseId: string) {
    const r = await this.db.query(
      `SELECT
         m.id, m.case_id AS "caseId", m.client_user_id AS "clientUserId",
         m.direction, m.author_user_id AS "authorUserId",
         COALESCE(p.display_name, CASE WHEN m.direction = 'CLIENT_TO_STAFF' THEN 'Client' ELSE 'Staff' END) AS "authorName",
         m.body, m.delivery_status AS "deliveryStatus",
         m.transport_message_id AS "transportMessageId",
         m.created_at AS "createdAt", m.sent_at AS "sentAt",
         m.delivered_at AS "deliveredAt", m.failed_at AS "failedAt"
       FROM ops_case_customer_messages_v2 m
       LEFT JOIN ops_staff_profiles p ON p.user_id = m.author_user_id
       WHERE m.case_id = $1
       ORDER BY m.created_at ASC`,
      [caseId]
    );
    return r.rows;
  }

  async reply(input: { caseId: string; actorUserId: string; actorScopes: string[]; body: string; requestId?: string | null }) {
    const client = await this.db.connect();
    let inserted: any;

    try {
      await client.query("BEGIN");

      // support_cases_v2.user_id (018_ga_hardening.sql) is the client this
      // case belongs to -- the pack this was adapted from assumed a
      // client_user_id column that doesn't exist on this table.
      const caseR = await client.query(
        `SELECT id, case_number, state, user_id AS "clientUserId"
         FROM support_cases_v2 WHERE id = $1 FOR UPDATE`,
        [input.caseId]
      );
      if (caseR.rowCount !== 1) throw new OpsHttpError("CASE_NOT_FOUND", 404);
      const caseRow = caseR.rows[0];
      if (!caseRow.clientUserId) throw new OpsHttpError("CASE_HAS_NO_CLIENT", 409);
      if (!canReplyToCase(caseRow.state)) throw new OpsHttpError("CASE_CLOSED", 409);

      const msgR = await client.query(
        `INSERT INTO ops_case_customer_messages_v2(
           case_id, client_user_id, direction, author_user_id, body, delivery_status
         ) VALUES($1,$2,'STAFF_TO_CLIENT',$3,$4,'PENDING')
         RETURNING id, case_id AS "caseId", client_user_id AS "clientUserId",
                   direction, author_user_id AS "authorUserId",
                   body, delivery_status AS "deliveryStatus", created_at AS "createdAt"`,
        [input.caseId, caseRow.clientUserId, input.actorUserId, input.body]
      );
      inserted = msgR.rows[0];

      await client.query(
        `INSERT INTO ops_audit_events(actor_user_id, actor_scope_snapshot, action, resource_type, resource_id, reason_code, request_id, before_json, after_json)
         VALUES($1,$2::jsonb,'ops.case.reply','support_case_v2',$3,'CUSTOMER_REPLY',$4,$5::jsonb,$6::jsonb)`,
        [
          input.actorUserId,
          JSON.stringify(input.actorScopes),
          input.caseId,
          input.requestId ?? null,
          JSON.stringify(caseRow),
          JSON.stringify(inserted)
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.support.addEvent({
      caseId: input.caseId,
      actorType: "STAFF",
      actorId: input.actorUserId,
      eventType: "ops.case.reply_queued",
      body: inserted.body
    });

    try {
      const result = await this.delivery.sendToClient({
        clientUserId: inserted.clientUserId,
        caseId: input.caseId,
        messageId: inserted.id,
        body: inserted.body
      });

      const u = await this.db.query(
        `UPDATE ops_case_customer_messages_v2
         SET delivery_status = 'SENT', transport_message_id = $2, sent_at = now(),
             delivery_error_code = NULL, delivery_error_message = NULL
         WHERE id = $1
         RETURNING delivery_status AS "deliveryStatus", transport_message_id AS "transportMessageId", sent_at AS "sentAt"`,
        [inserted.id, result.transportMessageId ?? inserted.id]
      );

      await this.support.addEvent({
        caseId: input.caseId,
        actorType: "STAFF",
        actorId: input.actorUserId,
        eventType: "ops.case.reply_sent",
        body: "Reply delivered to client"
      });

      return { ...inserted, ...u.rows[0] };
    } catch (error: any) {
      const code = typeof error?.code === "string" ? error.code : "DELIVERY_FAILED";
      const message = String(error?.message ?? error).slice(0, 1000);

      await this.db.query(
        `UPDATE ops_case_customer_messages_v2
         SET delivery_status = 'FAILED', delivery_error_code = $2, delivery_error_message = $3, failed_at = now()
         WHERE id = $1`,
        [inserted.id, code, message]
      );

      await this.support.addEvent({
        caseId: input.caseId,
        actorType: "STAFF",
        actorId: input.actorUserId,
        eventType: "ops.case.reply_failed",
        body: `Reply delivery failed: ${code}`
      });

      throw new OpsHttpError("CUSTOMER_REPLY_DELIVERY_FAILED", 502, { messageId: inserted.id, errorCode: code });
    }
  }
}
