import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";

// Mirrors the real support_cases_v2 CHECK constraints (018_ga_hardening.sql)
// exactly -- these are validated here too so a bad value gets a 400 with a
// clear error before ever reaching the database constraint.
const STATES = new Set(["OPEN", "WAITING_USER", "WAITING_INTERNAL", "RESOLVED", "CLOSED"]);
const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);

export function isValidCaseState(state: string): boolean {
  return STATES.has(state);
}

export function isValidCasePriority(priority: string): boolean {
  return PRIORITIES.has(priority);
}

class OpsHttpError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export class CaseStateService {
  private readonly support: SupportOperationsService;

  constructor(private readonly db: Database) {
    this.support = new SupportOperationsService(db);
  }

  updateState(input: { caseId: string; actorUserId: string; actorScopes: string[]; state: string; reasonCode: string; requestId?: string | null }) {
    if (!isValidCaseState(input.state)) throw new OpsHttpError("INVALID_CASE_STATE", 400);
    return this.change({
      caseId: input.caseId,
      actorUserId: input.actorUserId,
      actorScopes: input.actorScopes,
      column: "state",
      value: input.state,
      reasonCode: input.reasonCode,
      requestId: input.requestId ?? null,
      eventType: "ops.case.state_changed",
      auditAction: "ops.case.state.change"
    });
  }

  updatePriority(input: { caseId: string; actorUserId: string; actorScopes: string[]; priority: string; reasonCode: string; requestId?: string | null }) {
    if (!isValidCasePriority(input.priority)) throw new OpsHttpError("INVALID_CASE_PRIORITY", 400);
    return this.change({
      caseId: input.caseId,
      actorUserId: input.actorUserId,
      actorScopes: input.actorScopes,
      column: "priority",
      value: input.priority,
      reasonCode: input.reasonCode,
      requestId: input.requestId ?? null,
      eventType: "ops.case.priority_changed",
      auditAction: "ops.case.priority.change"
    });
  }

  private async change(input: {
    caseId: string;
    actorUserId: string;
    actorScopes: string[];
    column: "state" | "priority";
    value: string;
    reasonCode: string;
    requestId?: string | null;
    eventType: string;
    auditAction: string;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const before = await client.query(`SELECT id, state, priority FROM support_cases_v2 WHERE id = $1 FOR UPDATE`, [input.caseId]);
      if (before.rowCount !== 1) throw new OpsHttpError("CASE_NOT_FOUND", 404);
      const prevValue = before.rows[0][input.column];

      const after = await client.query(
        input.column === "state"
          ? `UPDATE support_cases_v2 SET state = $2, updated_at = now(), resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END
             WHERE id = $1 RETURNING id, case_number, state, priority, updated_at`
          : `UPDATE support_cases_v2 SET priority = $2, updated_at = now()
             WHERE id = $1 RETURNING id, case_number, state, priority, updated_at`,
        [input.caseId, input.value]
      );

      await client.query(
        `INSERT INTO ops_audit_events(actor_user_id, actor_scope_snapshot, action, resource_type, resource_id, reason_code, request_id, before_json, after_json)
         VALUES($1,$2::jsonb,$3,'support_case_v2',$4,$5,$6,$7::jsonb,$8::jsonb)`,
        [
          input.actorUserId,
          JSON.stringify(input.actorScopes),
          input.auditAction,
          input.caseId,
          input.reasonCode,
          input.requestId ?? null,
          JSON.stringify(before.rows[0]),
          JSON.stringify(after.rows[0])
        ]
      );

      await client.query("COMMIT");

      await this.support.addEvent({
        caseId: input.caseId,
        actorType: "STAFF",
        actorId: input.actorUserId,
        eventType: input.eventType,
        body: `${input.column} changed from ${prevValue} to ${input.value} (${input.reasonCode})`
      });

      return after.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
