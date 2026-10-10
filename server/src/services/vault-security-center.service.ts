import type { Pool } from "pg";
import type { PlatformSecurityAdapter } from "../integrations/vault/production-contracts.js";

export interface ConfiguredFlags {
  scanner: boolean;
  sharing: boolean;
  email: boolean;
  socialImport: boolean;
  socialExport: boolean;
  billing: boolean;
}

/**
 * Security Center. Two-factor, trusted devices and login alerts come from the platform's own
 * tables (passkeys, devices); the configuration rows say whether a provider is actually connected.
 * The Vault does not keep counters of its own for any of these.
 */
export class VaultSecurityCenterService {
  constructor(private readonly db: Pool, private readonly platform: PlatformSecurityAdapter, private readonly configured: () => ConfiguredFlags) {}

  async get(userId: string) {
    const [twoFactor, devices, alerts, audit] = await Promise.all([
      this.platform.getTwoFactor(userId),
      this.platform.getTrustedDevices(userId),
      this.platform.getLoginAlertPreference(userId),
      this.db.query("SELECT count(*)::int AS n FROM vault_audit_events e JOIN vault_workspaces w ON w.id = e.workspace_id WHERE w.owner_user_id = $1", [userId])
    ]);
    const flags = this.configured();
    return {
      encryption: { enabled: true, mode: "CLIENT_E2EE" as const },
      integrity: { enabled: true, auditEvents: (audit.rows[0]?.n as number | undefined) ?? 0 },
      scanner: { configured: flags.scanner },
      sharing: { configured: flags.sharing, email: flags.email, socialExport: flags.socialExport },
      socialImport: { configured: flags.socialImport },
      billing: { configured: flags.billing },
      twoFactor,
      trustedDevices: { count: devices.filter((d) => d.trusted).length, devices },
      loginAlerts: alerts,
      autoLockMinutes: 5
    };
  }

  async setLoginAlerts(userId: string, enabled: boolean) {
    await this.platform.setLoginAlertPreference(userId, enabled);
    await this.db.query("INSERT INTO vault_security_events (user_id, kind, severity, metadata) VALUES ($1,'LOGIN_ALERTS_CHANGED','INFO',$2)", [userId, JSON.stringify({ enabled })]);
    return { enabled };
  }
}
