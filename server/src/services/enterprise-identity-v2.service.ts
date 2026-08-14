import type { Database } from "../db/pool.js";

export class EnterpriseIdentityV2Service {
  constructor(private readonly db: Database) {}

  async requireOrganizationRole(input: { organizationId: string; userId: string; allowedRoles: string[] }) {
    // FIX (2026-08-07 apply pass): the pack queried a nonexistent
    // enterprise_roles_v2 table. Organization roles already live on
    // organization_memberships.role (007_three_milestones.sql).
    const result = await this.db.query(
      `SELECT role
       FROM organization_memberships
       WHERE organization_id=$1 AND user_id=$2 AND status='ACTIVE'`,
      [input.organizationId, input.userId]
    );

    const role = result.rows[0]?.role;
    if (!role || !input.allowedRoles.includes(role)) {
      throw new Error("organization authorization denied");
    }

    return role;
  }

  /** Not part of the source pack — added so a real OIDC connection can actually be looked up for verification (see auth/oidc-verifier.ts). */
  async getOidcConnection(organizationId: string) {
    const result = await this.db.query(
      `SELECT id,issuer,metadata
       FROM enterprise_identity_connections_v2
       WHERE organization_id=$1 AND provider_type='OIDC' AND enabled=TRUE
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] ?? null;
  }

  async enabledConnections(organizationId: string) {
    const result = await this.db.query(
      `SELECT id,provider_type,provider_name,issuer,metadata
       FROM enterprise_identity_connections_v2
       WHERE organization_id=$1 AND enabled=TRUE`,
      [organizationId]
    );
    return result.rows;
  }

  async enforceManagedDevice(organizationId: string, userId: string, deviceId: string) {
    // FIX: enterprise_policies_v2 doesn't exist. The real table
    // (007_three_milestones.sql) is `enterprise_policies`, a generic
    // key/value policy store (policy_key/policy_value JSONB), not a table
    // with a require_managed_device column.
    const policy = await this.db.query(
      `SELECT policy_value
       FROM enterprise_policies
       WHERE organization_id=$1 AND policy_key='require_managed_device'`,
      [organizationId]
    );

    if (policy.rows[0]?.policy_value !== true) {
      return;
    }

    const device = await this.db.query(
      `SELECT 1
       FROM federated_user_devices
       WHERE user_id=$1
         AND device_id=$2
         AND trust_state='TRUSTED'`,
      [userId, deviceId]
    );

    if (device.rowCount !== 1) {
      throw new Error("managed trusted device required");
    }
  }
}
