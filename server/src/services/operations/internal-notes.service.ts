import type { Database } from "../../db/pool.js";

export class InternalNotesService {
  constructor(private readonly db: Database) {}

  async add(input: { caseId: string; authorUserId: string; body: string }) {
    const result = await this.db.query(
      `INSERT INTO ops_case_internal_notes_v2(case_id, author_user_id, body)
       VALUES($1,$2,$3)
       RETURNING id, case_id, author_user_id, body, created_at`,
      [input.caseId, input.authorUserId, input.body]
    );
    return result.rows[0];
  }

  async list(caseId: string) {
    const result = await this.db.query(
      `SELECT n.id, n.case_id, n.author_user_id, n.body, n.created_at,
              s.display_name AS author_display_name
       FROM ops_case_internal_notes_v2 n
       LEFT JOIN ops_staff_profiles s ON s.user_id = n.author_user_id
       WHERE n.case_id = $1
       ORDER BY n.created_at ASC`,
      [caseId]
    );
    return result.rows;
  }
}
