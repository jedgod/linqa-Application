import type { Database } from "../db/pool.js";

export class OrganizationAuthorizationService {
  constructor(private readonly db: Database) {}

  async requireScope(input: {
    organizationId: string;
    subject: string;
    requiredScope: string;
  }) {
    const result = await this.db.query(
      `SELECT scopes
       FROM organization_api_grants
       WHERE organization_id=$1
         AND subject=$2
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at>now())`,
      [input.organizationId, input.subject]
    );

    const scopes: string[] = result.rows[0]?.scopes ?? [];
    if (!scopes.includes(input.requiredScope)) {
      throw new Error("organization-scoped authorization denied");
    }
  }
}
