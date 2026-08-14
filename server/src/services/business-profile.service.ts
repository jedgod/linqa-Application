import type { Database } from "../db/pool.js";

export class BusinessProfileService {
  constructor(private readonly db: Database) {}

  async upsert(input: {
    userId: string;
    organizationId?: string;
    displayName: string;
    category: string;
    description?: string;
    website?: string;
    supportHours?: Record<string, unknown>;
  }) {
    const result = await this.db.query(
      `INSERT INTO business_profiles (
         user_id,
         organization_id,
         display_name,
         category,
         description,
         website,
         support_hours
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id)
       DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         display_name = EXCLUDED.display_name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         website = EXCLUDED.website,
         support_hours = EXCLUDED.support_hours,
         updated_at = now()
       RETURNING *`,
      [
        input.userId,
        input.organizationId ?? null,
        input.displayName,
        input.category,
        input.description ?? null,
        input.website ?? null,
        input.supportHours ?? {}
      ]
    );

    return result.rows[0];
  }
}
