import type { Database } from "../db/pool.js";

export class ScimService {
  constructor(private readonly db: Database) {}

  async upsertUser(input: {
    organizationId: string;
    externalId?: string;
    userName: string;
    displayName?: string;
    active: boolean;
    rawAttributes?: Record<string, unknown>;
  }) {
    const result = await this.db.query(
      `INSERT INTO scim_directory_users (
         organization_id,
         external_id,
         user_name,
         display_name,
         active,
         raw_attributes
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, user_name)
       DO UPDATE SET
         external_id = EXCLUDED.external_id,
         display_name = EXCLUDED.display_name,
         active = EXCLUDED.active,
         raw_attributes = EXCLUDED.raw_attributes,
         updated_at = now()
       RETURNING id, user_name, active, created_at, updated_at`,
      [
        input.organizationId,
        input.externalId ?? null,
        input.userName,
        input.displayName ?? null,
        input.active,
        input.rawAttributes ?? {}
      ]
    );

    return result.rows[0];
  }

  async deactivate(input: {
    organizationId: string;
    scimUserId: string;
  }) {
    await this.db.query(
      `UPDATE scim_directory_users
       SET active = FALSE,
           updated_at = now()
       WHERE id = $1
         AND organization_id = $2`,
      [input.scimUserId, input.organizationId]
    );
  }
}
