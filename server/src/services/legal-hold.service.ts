import type { Database } from "../db/pool.js";

export class LegalHoldService {
  constructor(private readonly db: Database) {}

  async create(input: {
    organizationId: string;
    name: string;
    scope: Record<string, unknown>;
    createdByUserId: string;
  }) {
    const result = await this.db.query(
      `INSERT INTO legal_holds (
         organization_id,
         name,
         scope,
         status,
         created_by_user_id
       ) VALUES ($1,$2,$3,'ACTIVE',$4)
       RETURNING id, created_at`,
      [
        input.organizationId,
        input.name,
        input.scope,
        input.createdByUserId
      ]
    );

    return result.rows[0];
  }

  async release(input: {
    organizationId: string;
    holdId: string;
  }) {
    const result = await this.db.query(
      `UPDATE legal_holds
       SET status = 'RELEASED',
           released_at = now()
       WHERE id = $1
         AND organization_id = $2
         AND status = 'ACTIVE'`,
      [input.holdId, input.organizationId]
    );

    if (result.rowCount !== 1) {
      throw new Error("active legal hold not found");
    }
  }
}
