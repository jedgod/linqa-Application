import type { Pool } from "pg";
import type { SensitiveAction, StepUpVerifier } from "../../security/step-up.js";
import type { PlatformSecurityAdapter, StepUpAdapter, UserDirectory } from "./production-contracts.js";

/**
 * Bindings to authorities that already exist in this platform (v7 mapping worksheet):
 *  - devices table                 -> trusted devices (status ACTIVE, not revoked)
 *  - webauthn_credentials          -> second factor (passkeys)
 *  - device_security_alerts        -> signals that a device or credential set changed
 *  - StepUpService                 -> biometric/passkey step-up proofs
 *  - usernames                     -> Linqa user lookup
 * Nothing here invents Vault counters: every value comes from the platform's own tables.
 */
export class LivePlatformSecurity implements PlatformSecurityAdapter {
  constructor(private readonly db: Pool) {}

  async getTwoFactor(userId: string) {
    const { rows } = await this.db.query("SELECT count(*)::int AS n FROM webauthn_credentials WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    const n = rows[0]?.n ?? 0;
    return { enabled: n > 0, methods: n > 0 ? ["PASSKEY"] : [] };
  }

  async getTrustedDevices(userId: string) {
    const { rows } = await this.db.query("SELECT id, device_name, platform, status, revoked_at, last_seen_at FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC NULLS LAST", [userId]);
    return rows.map((r) => ({
      id: r.id as string,
      name: (r.device_name as string) ?? "Device",
      platform: (r.platform as string) ?? "",
      trusted: r.revoked_at === null && String(r.status).toUpperCase() === "ACTIVE",
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null
    }));
  }

  async getLoginAlertPreference(userId: string) {
    const { rows } = await this.db.query("SELECT enabled FROM vault_login_alert_preferences WHERE user_id = $1", [userId]);
    return { enabled: rows[0]?.enabled ?? true };
  }

  async setLoginAlertPreference(userId: string, enabled: boolean) {
    await this.db.query(
      `INSERT INTO vault_login_alert_preferences (user_id, enabled) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = now()`,
      [userId, enabled]
    );
  }
}

export class LiveStepUp implements StepUpAdapter {
  constructor(private readonly verifier: StepUpVerifier) {}

  async verifyAndConsume(input: Parameters<StepUpAdapter["verifyAndConsume"]>[0]) {
    const claims = await this.verifier.verifyAndConsume(input.proof, { userId: input.userId, deviceId: input.deviceId, action: input.purpose as SensitiveAction });
    return { jti: claims.jti };
  }
}

export class LiveUserDirectory implements UserDirectory {
  constructor(private readonly db: Pool) {}

  async resolve(handle: string) {
    const normalized = handle.trim().replace(/^@/, "").toLowerCase();
    if (!normalized || normalized.length > 64) return null;
    const { rows } = await this.db.query("SELECT user_id FROM usernames WHERE normalized_username = $1", [normalized]);
    return rows[0] ? { userId: rows[0].user_id as string } : null;
  }
}
