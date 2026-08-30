import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";
import { OpsHttpError } from "./specialist-review.js";

// This repo has no "support-safe summary" methods on existing domain
// services (file-vault.service.ts, trust-safety.service.ts, etc. only
// expose their own write-path operations) and no dedicated LinqaSend
// "account" table, 2FA/TOTP table, or vault quota/plan table -- see
// Admin-Staff/Admin-Staff_page/Linqa_Repo_Native_Client360_Account_Services_Enrichment_Pack.txt,
// which assumed both existed. Rather than invent a service layer that
// doesn't exist or fabricate numbers no table backs, this reads the real
// tables directly (devices, webauthn_credentials, recovery_email_identities_v3,
// trusted_installation_devices_v3, linqasend_payment_methods,
// linqasend_transfers, vault_items, safety_reports) and leaves a field null
// wherever this schema genuinely has no concept for it yet. The
// `availability` map on the response reflects per-domain query success, not
// "this repo has that data" -- a null field with availability:true is a
// real "no data" answer, not a fetch failure.

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!domain || !user) return "***";
  const visible = user.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(user.length - 1, 3))}@${domain}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export type SafetyReportSignal = { status: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" };

// Factored out of getRisk() so the severity-escalation rule is
// unit-testable without a database -- mirrors the isWorkableState /
// assignmentRejectionReason pattern in case-assignment.service.ts.
export function deriveRiskLevel(reports: SafetyReportSignal[]): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const open = reports.filter((r) => r.status !== "CLOSED");
  if (open.some((r) => r.severity === "CRITICAL")) return "CRITICAL";
  if (open.some((r) => r.severity === "HIGH")) return "HIGH";
  return open.length > 0 ? "MEDIUM" : "LOW";
}

export class Client360Service {
  private readonly support: SupportOperationsService;

  constructor(private readonly db: Database) {
    this.support = new SupportOperationsService(db);
  }

  async getForCase(caseId: string) {
    const supportCase = await this.support.getCaseById(caseId);
    if (!supportCase) throw new OpsHttpError("CASE_NOT_FOUND", 404);

    const userId: string | null = supportCase.user_id;
    if (!userId) {
      return {
        caseId: supportCase.id,
        caseNumber: supportCase.case_number,
        userId: null,
        identity: null,
        devices: null,
        linqaSend: null,
        vault: null,
        recovery: null,
        risk: null,
        availability: { account: false, devices: false, linqaSend: false, vault: false, recovery: false, risk: false }
      };
    }

    const results = await Promise.allSettled([
      this.getIdentity(userId),
      this.getDevices(userId),
      this.getLinqaSend(userId),
      this.getVault(userId),
      this.getRecovery(userId),
      this.getRisk(userId)
    ]);

    const [identityR, devicesR, linqaSendR, vaultR, recoveryR, riskR] = results;
    const pick = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);

    return {
      caseId: supportCase.id,
      caseNumber: supportCase.case_number,
      userId,
      identity: pick(identityR),
      devices: pick(devicesR),
      linqaSend: pick(linqaSendR),
      vault: pick(vaultR),
      recovery: pick(recoveryR),
      risk: pick(riskR),
      availability: {
        account: identityR.status === "fulfilled",
        devices: devicesR.status === "fulfilled",
        linqaSend: linqaSendR.status === "fulfilled",
        vault: vaultR.status === "fulfilled",
        recovery: recoveryR.status === "fulfilled",
        risk: riskR.status === "fulfilled"
      }
    };
  }

  private async getIdentity(userId: string) {
    const u = await this.db.query(
      `SELECT status, verified_country_code AS "countryCode", country_verification_state, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    if (!u.rowCount) return null;
    const row = u.rows[0];

    const profile = await this.db.query(`SELECT display_name FROM user_profiles WHERE user_id = $1`, [userId]);

    const ids = await this.db.query(
      `SELECT type, display_value, verified_at
       FROM account_identifiers
       WHERE user_id = $1 AND disabled_at IS NULL
       ORDER BY is_primary DESC, created_at ASC`,
      [userId]
    );
    const email = ids.rows.find((r: any) => r.type === "EMAIL");
    const phone = ids.rows.find((r: any) => r.type === "PHONE");

    return {
      displayName: profile.rows[0]?.display_name ?? null,
      maskedEmail: email ? maskEmail(email.display_value) : null,
      maskedPhone: phone ? maskPhone(phone.display_value) : null,
      accountState: row.status,
      countryCode: row.countryCode ?? null,
      emailVerified: email ? email.verified_at !== null : null,
      phoneVerified: phone ? phone.verified_at !== null : null,
      memberSince: iso(row.created_at)
    };
  }

  private async getDevices(userId: string) {
    const r = await this.db.query(
      `SELECT platform, status, last_seen_at
       FROM devices WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId]
    );
    const active = r.rows.filter((d: any) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 30 * 24 * 3600 * 1000);
    const lastSeen = r.rows.reduce<Date | null>((max, d: any) => {
      if (!d.last_seen_at) return max;
      const t = new Date(d.last_seen_at);
      return !max || t > max ? t : max;
    }, null);

    return {
      trustedDeviceCount: r.rowCount ?? 0,
      activeDeviceCount: active.length,
      lastTrustedDeviceSeenAt: iso(lastSeen),
      platforms: [...new Set(r.rows.map((d: any) => d.platform as string))]
    };
  }

  private async getLinqaSend(userId: string) {
    const methods = await this.db.query(
      `SELECT verification_status FROM linqasend_payment_methods
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY updated_at DESC`,
      [userId]
    );
    if (!methods.rowCount) {
      return { enabled: false, accountState: "NOT_SET_UP", verificationState: null, activeHoldCount: 0, lastTransactionAt: null };
    }
    const hasVerified = methods.rows.some((m: any) => m.verification_status === "VERIFIED");

    const transfers = await this.db.query(
      `SELECT
         MAX(created_at) AS "lastTransactionAt",
         COUNT(*) FILTER (WHERE status IN ('ON_HOLD','MANUAL_REVIEW','RISK_REVIEW')) AS "activeHoldCount"
       FROM linqasend_transfers WHERE user_id = $1`,
      [userId]
    );

    return {
      enabled: true,
      accountState: hasVerified ? "ACTIVE" : "PENDING_VERIFICATION",
      verificationState: methods.rows[0].verification_status,
      activeHoldCount: Number(transfers.rows[0]?.activeHoldCount ?? 0),
      lastTransactionAt: iso(transfers.rows[0]?.lastTransactionAt ?? null)
    };
  }

  private async getVault(userId: string) {
    const r = await this.db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(encrypted_size), 0) AS "usedBytes"
       FROM vault_items WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    const count = Number(r.rows[0]?.count ?? 0);
    return {
      enabled: count > 0,
      planName: null,
      usedBytes: Number(r.rows[0]?.usedBytes ?? 0),
      quotaBytes: null,
      quarantineCount: null
    };
  }

  private async getRecovery(userId: string) {
    const email = await this.db.query(
      `SELECT verification_state, verified_at FROM recovery_email_identities_v3 WHERE user_id = $1`,
      [userId]
    );
    const passkeys = await this.db.query(
      `SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    const trustedDevices = await this.db.query(
      `SELECT COUNT(*) AS count FROM trusted_installation_devices_v3 WHERE user_id = $1 AND trust_state = 'TRUSTED'`,
      [userId]
    );

    return {
      recoveryEmailConfigured: email.rows[0]?.verification_state === "VERIFIED",
      trustedRecoveryDeviceCount: Number(trustedDevices.rows[0]?.count ?? 0),
      // No dedicated 2FA/TOTP table exists in this schema -- WebAuthn
      // passkeys are the closest concept and are reported separately via
      // passkeyCount, so this stays an honest "unknown" rather than an
      // invented flag.
      twoFactorEnabled: null,
      passkeyCount: Number(passkeys.rows[0]?.count ?? 0),
      lastRecoveryAt: iso(email.rows[0]?.verified_at ?? null)
    };
  }

  private async getRisk(userId: string) {
    const account = await this.db.query(`SELECT status FROM users WHERE id = $1`, [userId]);
    const reports = await this.db.query(
      `SELECT status, severity, updated_at FROM safety_reports WHERE reported_user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    const open = reports.rows.filter((r: any) => r.status !== "CLOSED");
    const level = deriveRiskLevel(reports.rows);

    return {
      level,
      score: null,
      openRiskCaseCount: open.length,
      safetyRestrictionActive: account.rows[0]?.status === "SUSPENDED",
      lastReviewedAt: iso(reports.rows[0]?.updated_at ?? null)
    };
  }
}
