import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";

// The pack this was adapted from queried these three tables through
// to_jsonb(row) + a chain of `row.x ?? row.y ?? row.z` fallbacks, guessing
// at column names it wasn't sure of. All three tables' real columns are
// already known in this repo (recovery_email_identities_v3 and
// webauthn_credentials from 023_phone_first_recovery_email.sql /
// 013_industrial_completion.sql; trusted_installation_devices_v3 has no
// `id`, `label`, or `platform` column at all -- it's a composite-key join
// table between device_installations_v2 and devices), so this queries them
// directly instead of carrying that guessing logic forward.

export type RecoveryEmailEvidence = {
  id: string;
  maskedEmail: string;
  state: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TrustedDeviceEvidence = {
  id: string;
  label: string;
  platform: string | null;
  state: string;
  trusted: boolean;
  lastSeenAt: string | null;
};

export type PasskeyEvidence = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
};

export type RecoveryEvidenceSummary = {
  verifiedRecoveryEmailCount: number;
  trustedDeviceCount: number;
  activePasskeyCount: number;
};

// Factored out so the client's "is approval reasonable given what's on
// screen" nudge has a server-side equivalent that's unit-testable without a
// database -- mirrors deriveRiskLevel in client360.service.ts.
export function hasStrongEvidence(summary: RecoveryEvidenceSummary): boolean {
  return summary.verifiedRecoveryEmailCount > 0 || summary.trustedDeviceCount > 0 || summary.activePasskeyCount > 0;
}

export class RecoveryEvidenceService {
  private readonly support: SupportOperationsService;

  constructor(private readonly db: Database) {
    this.support = new SupportOperationsService(db);
  }

  async getForCase(caseId: string) {
    const supportCase = await this.support.getCaseById(caseId);
    if (!supportCase) return null;

    const userId: string | null = supportCase.user_id;
    if (!userId) {
      return {
        caseId: supportCase.id,
        caseNumber: supportCase.case_number,
        userId: null,
        caseState: supportCase.state,
        priority: supportCase.priority,
        evidence: {
          recoveryEmails: [],
          trustedDevices: [],
          passkeys: [],
          summary: { verifiedRecoveryEmailCount: 0, trustedDeviceCount: 0, activePasskeyCount: 0 }
        },
        review: null
      };
    }

    const [emailR, deviceR, passkeyR, reviewR] = await Promise.all([
      this.db.query(
        `SELECT id, masked_email AS "maskedEmail", verification_state, verified_at, created_at, updated_at
         FROM recovery_email_identities_v3
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [userId]
      ),
      this.db.query(
        `SELECT
           t.device_id AS id,
           COALESCE(d.device_name, 'Trusted device') AS label,
           i.platform AS platform,
           t.trust_state AS state,
           COALESCE(i.last_seen_at, t.trusted_at) AS "lastSeenAt"
         FROM trusted_installation_devices_v3 t
         JOIN device_installations_v2 i ON i.id = t.installation_id
         LEFT JOIN devices d ON d.id = t.device_id
         WHERE t.user_id = $1
         ORDER BY COALESCE(i.last_seen_at, t.trusted_at) DESC NULLS LAST`,
        [userId]
      ),
      this.db.query(
        `SELECT id, COALESCE(nickname, device_type) AS label, created_at, last_used_at, revoked_at
         FROM webauthn_credentials
         WHERE user_id = $1
         ORDER BY COALESCE(last_used_at, created_at) DESC`,
        [userId]
      ),
      this.db.query(
        `SELECT
           id, decision, reviewer_user_id AS "reviewerUserId",
           specialist_note AS "specialistNote", reason_code AS "reasonCode",
           evidence_snapshot AS "evidenceSnapshot", reviewed_at AS "reviewedAt",
           created_at AS "createdAt", updated_at AS "updatedAt"
         FROM ops_recovery_reviews_v1
         WHERE case_id = $1
         LIMIT 1`,
        [caseId]
      )
    ]);

    const recoveryEmails: RecoveryEmailEvidence[] = emailR.rows.map((r: any) => ({
      id: r.id,
      maskedEmail: r.maskedEmail,
      state: r.verification_state,
      verified: r.verification_state === "VERIFIED",
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));

    const trustedDevices: TrustedDeviceEvidence[] = deviceR.rows.map((r: any) => ({
      id: r.id,
      label: r.label,
      platform: r.platform ?? null,
      state: r.state,
      trusted: r.state === "TRUSTED",
      lastSeenAt: r.lastSeenAt ?? null
    }));

    const passkeys: PasskeyEvidence[] = passkeyR.rows.map((r: any) => ({
      id: r.id,
      label: r.label ?? "Passkey",
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at ?? null,
      active: r.revoked_at === null
    }));

    const summary: RecoveryEvidenceSummary = {
      verifiedRecoveryEmailCount: recoveryEmails.filter((x) => x.verified).length,
      trustedDeviceCount: trustedDevices.filter((x) => x.trusted).length,
      activePasskeyCount: passkeys.filter((x) => x.active).length
    };

    return {
      caseId: supportCase.id,
      caseNumber: supportCase.case_number,
      userId,
      caseState: supportCase.state,
      priority: supportCase.priority,
      evidence: { recoveryEmails, trustedDevices, passkeys, summary },
      review: reviewR.rows[0] ?? null
    };
  }
}
