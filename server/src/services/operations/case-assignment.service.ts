import type { Database } from "../../db/pool.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { SupportOperationsService } from "../support-operations.service.js";

// support_cases_v2.state (018_ga_hardening.sql) has no "ASSIGNED"/"QUEUED"
// step -- assignment is orthogonal to state in this schema. A case stops
// being workable once it's RESOLVED or CLOSED.
const WORKABLE_STATES = new Set(["OPEN", "WAITING_USER", "WAITING_INTERNAL"]);

export function isWorkableState(state: string): boolean {
  return WORKABLE_STATES.has(state);
}

export type StaffCapacitySnapshot = {
  suspended: boolean;
  presence: "AVAILABLE" | "BUSY" | "AWAY" | "OFFLINE";
  activeCaseCount: number;
  maxConcurrentCases: number;
};

/**
 * Pure eligibility check, factored out of assign() so the capacity/presence
 * boundary conditions are unit-testable without a database. The actual
 * assign() transaction re-reads these same fields under `FOR UPDATE` --
 * this function is the single source of truth for what "eligible" means,
 * not a duplicate of the check.
 */
export function assignmentRejectionReason(staff: StaffCapacitySnapshot): "STAFF_SUSPENDED" | "STAFF_OFFLINE" | "STAFF_CAPACITY_REACHED" | null {
  if (staff.suspended) return "STAFF_SUSPENDED";
  if (staff.presence === "OFFLINE") return "STAFF_OFFLINE";
  if (staff.activeCaseCount >= staff.maxConcurrentCases) return "STAFF_CAPACITY_REACHED";
  return null;
}

class OpsHttpError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export class CaseAssignmentService {
  private readonly support: SupportOperationsService;

  constructor(
    private readonly db: Database,
    private readonly hub?: RealtimeHub
  ) {
    this.support = new SupportOperationsService(db);
  }

  async assign(input: {
    caseId: string;
    targetStaffId: string;
    actorUserId: string;
    actorScopes: string[];
    reasonCode: string;
    assignmentType: "MANUAL" | "REASSIGN" | "ESCALATION";
    requestId?: string | null;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const caseRow = await client.query(
        `SELECT * FROM support_cases_v2 WHERE id = $1 FOR UPDATE`,
        [input.caseId]
      );
      if (caseRow.rowCount !== 1) throw new OpsHttpError("CASE_NOT_FOUND", 404);
      const c = caseRow.rows[0];
      if (!isWorkableState(c.state)) throw new OpsHttpError("CASE_NOT_ASSIGNABLE", 409);

      const staffRow = await client.query(
        `SELECT * FROM ops_staff_profiles WHERE id = $1 FOR UPDATE`,
        [input.targetStaffId]
      );
      if (staffRow.rowCount !== 1) throw new OpsHttpError("STAFF_NOT_FOUND", 404);
      const staff = staffRow.rows[0];
      const rejection = assignmentRejectionReason({
        suspended: staff.suspended,
        presence: staff.presence,
        activeCaseCount: Number(staff.active_case_count),
        maxConcurrentCases: Number(staff.max_concurrent_cases)
      });
      if (rejection) throw new OpsHttpError(rejection, 409);

      const previousStaffId: string | null = c.assigned_staff_id ?? null;

      if (previousStaffId && previousStaffId !== input.targetStaffId) {
        await client.query(
          `UPDATE ops_case_assignments_v2 SET released_at = now(), release_reason = 'REASSIGNED'
           WHERE case_id = $1 AND released_at IS NULL`,
          [input.caseId]
        );
        await client.query(
          `UPDATE ops_staff_profiles SET active_case_count = GREATEST(active_case_count - 1, 0), updated_at = now()
           WHERE id = $1`,
          [previousStaffId]
        );
      }

      if (previousStaffId !== input.targetStaffId) {
        await client.query(
          `INSERT INTO ops_case_assignments_v2(case_id, staff_id, assigned_by_user_id, assignment_type, reason_code)
           VALUES($1,$2,$3,$4,$5)`,
          [input.caseId, input.targetStaffId, input.actorUserId, input.assignmentType, input.reasonCode]
        );
        await client.query(
          `UPDATE ops_staff_profiles SET active_case_count = active_case_count + 1, updated_at = now()
           WHERE id = $1`,
          [input.targetStaffId]
        );
      }

      const updated = await client.query(
        `UPDATE support_cases_v2
         SET assigned_staff_id = $2, assigned_agent = $3, assigned_team = COALESCE($4, assigned_team), updated_at = now()
         WHERE id = $1
         RETURNING id, case_number, state, priority, category, assigned_agent, assigned_team, updated_at`,
        [input.caseId, input.targetStaffId, staff.display_name, staff.team_name]
      );

      await client.query(
        `INSERT INTO ops_outbox(aggregate_type, aggregate_id, event_type, payload)
         VALUES('support_case', $1, 'ops.case.assigned', $2::jsonb)`,
        [input.caseId, JSON.stringify({ caseId: input.caseId, previousStaffId, targetStaffId: input.targetStaffId })]
      );

      await client.query(
        `INSERT INTO ops_audit_events(actor_user_id, actor_scope_snapshot, action, resource_type, resource_id, reason_code, request_id, before_json, after_json)
         VALUES($1,$2::jsonb,'ops.case.assign','support_case_v2',$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          input.actorUserId,
          JSON.stringify(input.actorScopes),
          input.caseId,
          input.reasonCode,
          input.requestId ?? null,
          JSON.stringify(c),
          JSON.stringify(updated.rows[0])
        ]
      );

      await client.query("COMMIT");

      await this.support.addEvent({
        caseId: input.caseId,
        actorType: "STAFF",
        actorId: input.actorUserId,
        eventType: "ops.case.assigned",
        body: `Assigned to ${staff.display_name}`
      });

      this.hub?.sendToUser(staff.user_id, {
        type: "ops.case.assigned",
        caseId: input.caseId,
        caseNumber: updated.rows[0].case_number
      });

      return updated.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async release(input: { caseId: string; actorUserId: string; actorScopes: string[]; reasonCode: string; requestId?: string | null }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const caseRow = await client.query(`SELECT * FROM support_cases_v2 WHERE id = $1 FOR UPDATE`, [input.caseId]);
      if (caseRow.rowCount !== 1) throw new OpsHttpError("CASE_NOT_FOUND", 404);
      const c = caseRow.rows[0];
      const owner: string | null = c.assigned_staff_id ?? null;

      if (!owner) {
        await client.query("COMMIT");
        return c;
      }

      await client.query(
        `UPDATE ops_case_assignments_v2 SET released_at = now(), release_reason = $2 WHERE case_id = $1 AND released_at IS NULL`,
        [input.caseId, input.reasonCode]
      );
      await client.query(
        `UPDATE ops_staff_profiles SET active_case_count = GREATEST(active_case_count - 1, 0), updated_at = now() WHERE id = $1`,
        [owner]
      );
      const updated = await client.query(
        `UPDATE support_cases_v2 SET assigned_staff_id = NULL, updated_at = now() WHERE id = $1
         RETURNING id, case_number, state, priority, category, assigned_agent, assigned_team, updated_at`,
        [input.caseId]
      );

      await client.query(
        `INSERT INTO ops_outbox(aggregate_type, aggregate_id, event_type, payload) VALUES('support_case', $1, 'ops.case.released', $2::jsonb)`,
        [input.caseId, JSON.stringify({ caseId: input.caseId, previousStaffId: owner })]
      );
      await client.query(
        `INSERT INTO ops_audit_events(actor_user_id, actor_scope_snapshot, action, resource_type, resource_id, reason_code, request_id, before_json, after_json)
         VALUES($1,$2::jsonb,'ops.case.release','support_case_v2',$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          input.actorUserId,
          JSON.stringify(input.actorScopes),
          input.caseId,
          input.reasonCode,
          input.requestId ?? null,
          JSON.stringify(c),
          JSON.stringify(updated.rows[0])
        ]
      );

      await client.query("COMMIT");

      await this.support.addEvent({
        caseId: input.caseId,
        actorType: "STAFF",
        actorId: input.actorUserId,
        eventType: "ops.case.released",
        body: "Released back to queue"
      });

      return updated.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
