import type { Database } from "../../db/pool.js";

export class OperationsDashboardService {
  constructor(private readonly db: Database) {}

  async overview() {
    const [cases, staff] = await Promise.all([
      this.db.query(
        `SELECT
           count(*) FILTER (WHERE state NOT IN ('RESOLVED','CLOSED'))::int AS "openCases",
           count(*) FILTER (WHERE state NOT IN ('RESOLVED','CLOSED') AND assigned_staff_id IS NULL)::int AS "unassignedCases",
           count(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at::date = current_date)::int AS "resolvedToday"
         FROM support_cases_v2`
      ),
      this.db.query(
        `SELECT
           count(*) FILTER (WHERE presence = 'AVAILABLE')::int AS "availableStaff",
           count(*) FILTER (WHERE presence = 'BUSY')::int AS "busyStaff",
           count(*)::int AS "totalStaff"
         FROM ops_staff_profiles WHERE suspended = false`
      )
    ]);

    const c = cases.rows[0] ?? {};
    const s = staff.rows[0] ?? {};
    return {
      openCases: Number(c.openCases ?? 0),
      unassignedCases: Number(c.unassignedCases ?? 0),
      resolvedToday: Number(c.resolvedToday ?? 0),
      availableStaff: Number(s.availableStaff ?? 0),
      busyStaff: Number(s.busyStaff ?? 0),
      totalStaff: Number(s.totalStaff ?? 0)
    };
  }
}
