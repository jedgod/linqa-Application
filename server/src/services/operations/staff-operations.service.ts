import type { Database } from "../../db/pool.js";

export class StaffOperationsService {
  constructor(private readonly db: Database) {}

  async listLiveStaff() {
    const r = await this.db.query(
      `SELECT id, user_id AS "userId", display_name AS "displayName", staff_role AS "staffRole",
              team_name AS "teamName", presence::text, active_case_count AS "activeCases",
              max_concurrent_cases AS "maxConcurrentCases", last_seen_at AS "lastSeenAt"
       FROM ops_staff_profiles
       WHERE suspended = false
       ORDER BY CASE presence WHEN 'AVAILABLE' THEN 0 WHEN 'BUSY' THEN 1 WHEN 'AWAY' THEN 2 ELSE 3 END,
                display_name`
    );
    return r.rows;
  }

  async getProfileByUserId(userId: string) {
    const r = await this.db.query(
      `SELECT id, user_id AS "userId", display_name AS "displayName", staff_role AS "staffRole",
              team_name AS "teamName", presence::text, active_case_count AS "activeCases",
              max_concurrent_cases AS "maxConcurrentCases", suspended
       FROM ops_staff_profiles WHERE user_id = $1`,
      [userId]
    );
    return r.rows[0] ?? null;
  }

  async getMyWork(userId: string) {
    const profile = await this.getProfileByUserId(userId);
    if (!profile) throw Object.assign(new Error("STAFF_PROFILE_NOT_FOUND"), { statusCode: 404 });

    const r = await this.db.query(
      `SELECT id, case_number AS "caseNumber", state, priority, category, subject, updated_at AS "updatedAt"
       FROM support_cases_v2
       WHERE assigned_staff_id = $1 AND state NOT IN ('RESOLVED','CLOSED')
       ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                updated_at DESC`,
      [profile.id]
    );
    return r.rows;
  }

  async listUnassigned(limit = 25) {
    const r = await this.db.query(
      `SELECT id, case_number AS "caseNumber", state, priority, category, subject, created_at AS "createdAt"
       FROM support_cases_v2
       WHERE assigned_staff_id IS NULL AND state NOT IN ('RESOLVED','CLOSED')
       ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                created_at ASC
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  }
}
