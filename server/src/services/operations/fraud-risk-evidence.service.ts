import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";
import { deriveRiskLevel, type SafetyReportSignal } from "./client360.service.js";
import { HIGH_VALUE_TRANSFER_MINOR } from "../linqasend/risk-engine.service.js";

// Adapted from Admin-Staff/Admin-Staff_page/
// Linqa_Repo_Native_Fraud_Risk_Specialist_Review_Pack.txt. The pack read all
// three evidence tables through to_jsonb(row) plus `row.a ?? row.b ?? row.c`
// column guessing, and every one of its guesses is wrong against this schema:
//
//   safety_reports          has no user_id at all (it's reporter_user_id /
//                           reported_user_id), so the pack's WHERE clause
//                           would have thrown 42703 on the first request.
//   linqasend_transfers     has no sender_user_id/recipient_user_id (it's
//                           user_id and recipient_id -> linqasend_recipients),
//                           and no `amount`: the money column is
//                           send_amount_minor, in MINOR units. The pack's
//                           `Number(row.amount ?? ...) || 0` would have made
//                           every transfer look like 0.00.
//   payment methods         are `type`, not `method_type`, and are soft
//                           deleted via deleted_at, which the pack ignored.
//
// So this queries the real columns directly, the same way
// recovery-evidence.service.ts and client360.service.ts already do.

export type SafetyReportEvidence = {
  id: string;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  open: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RiskPaymentMethodEvidence = {
  id: string;
  type: string;
  verificationStatus: string;
  verified: boolean;
  createdAt: string;
};

export type RiskTransferEvidence = {
  id: string;
  publicId: string;
  status: string;
  sendAmountMinor: number;
  sendCurrency: string;
  highValue: boolean;
  createdAt: string;
};

export type FraudRiskEvidenceSummary = {
  openSafetyReportCount: number;
  highValueTransferCount: number;
  unverifiedPaymentMethodCount: number;
  userSuspended: boolean;
};

// The pack shipped its own deriveRiskLevel with a *different* severity ladder
// from the one already in client360.service.ts (its version returns LOW for an
// open LOW-severity report where Client 360 returns MEDIUM). Two different
// risk levels for the same user on two panels of the same case workspace is a
// bug a specialist would notice, so this composes the existing rule instead of
// redefining it, and layers on only the pack's genuinely new idea: a suspended
// account outranks whatever the reports say.
export function deriveFraudRiskLevel(
  reports: SafetyReportSignal[],
  userStatus: string | null | undefined
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (userStatus === "SUSPENDED") return "CRITICAL";
  return deriveRiskLevel(reports);
}

// Mirrors hasStrongEvidence in recovery-evidence.service.ts: gives the client's
// "is this decision reasonable given what's on screen" nudge a server-side
// equivalent that's unit-testable without a database.
export function hasActionableRiskEvidence(summary: FraudRiskEvidenceSummary): boolean {
  return (
    summary.openSafetyReportCount > 0 ||
    summary.highValueTransferCount > 0 ||
    summary.unverifiedPaymentMethodCount > 0 ||
    summary.userSuspended
  );
}

const EMPTY_SUMMARY: FraudRiskEvidenceSummary = {
  openSafetyReportCount: 0,
  highValueTransferCount: 0,
  unverifiedPaymentMethodCount: 0,
  userSuspended: false
};

export class FraudRiskEvidenceService {
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
          user: { status: null, suspended: false },
          risk: { level: "LOW" as const, score: null },
          safetyReports: [],
          paymentMethods: [],
          transfers: [],
          summary: EMPTY_SUMMARY
        },
        review: null
      };
    }

    const [userR, safetyR, paymentsR, transfersR, riskScoreR, reviewR] = await Promise.all([
      this.db.query(`SELECT status FROM users WHERE id = $1`, [userId]),
      // reported_user_id, matching getRisk() in client360.service.ts: the
      // fraud signal is reports filed ABOUT this account, not by it.
      this.db.query(
        `SELECT id, category, severity, status, created_at, updated_at
         FROM safety_reports
         WHERE reported_user_id = $1
         ORDER BY updated_at DESC
         LIMIT 100`,
        [userId]
      ),
      this.db.query(
        `SELECT id, type, verification_status, created_at
         FROM linqasend_payment_methods
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
        [userId]
      ),
      // Transfers this user sent, plus transfers sent TO them where the
      // recipient record is linked back to a Linqa account. The pack wanted
      // "sender or recipient" but assumed both were plain columns on the
      // transfer; the recipient side is actually a join through
      // linqasend_recipients.linqa_user_id.
      this.db.query(
        `SELECT t.id, t.public_id, t.status::text AS status,
                t.send_amount_minor, t.send_currency, t.created_at
         FROM linqasend_transfers t
         LEFT JOIN linqasend_recipients r ON r.id = t.recipient_id
         WHERE t.user_id = $1 OR r.linqa_user_id = $1
         ORDER BY t.created_at DESC
         LIMIT 100`,
        [userId]
      ),
      // linqasend_risk_assessments is real scored output from
      // RiskEngineService, written per transfer during the send flow. The
      // pack hardcoded `score: null` because it assumed nothing in the repo
      // scored risk; the worst score across this account's recent transfers
      // is a genuine number a fraud analyst can act on.
      this.db.query(
        `SELECT MAX(a.combined_score) AS "maxScore"
         FROM linqasend_risk_assessments a
         JOIN linqasend_transfers t ON t.id = a.transfer_id
         WHERE t.user_id = $1`,
        [userId]
      ),
      this.db.query(
        `SELECT id, decision, reviewer_user_id AS "reviewerUserId",
                specialist_note AS "specialistNote", reason_code AS "reasonCode",
                evidence_snapshot AS "evidenceSnapshot", reviewed_at AS "reviewedAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM ops_fraud_risk_reviews_v1
         WHERE case_id = $1
         LIMIT 1`,
        [caseId]
      )
    ]);

    const userStatus: string | null = userR.rows[0]?.status ?? null;

    const safetyReports: SafetyReportEvidence[] = safetyR.rows.map((r: any) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      status: r.status,
      open: r.status !== "CLOSED",
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));

    const paymentMethods: RiskPaymentMethodEvidence[] = paymentsR.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      verificationStatus: r.verification_status,
      verified: r.verification_status === "VERIFIED",
      createdAt: r.created_at
    }));

    const transfers: RiskTransferEvidence[] = transfersR.rows.map((r: any) => ({
      id: r.id,
      publicId: r.public_id,
      status: r.status,
      // pg returns bigint as a string; minor units stay well inside Number's
      // safe range, and a JSON response can't carry a BigInt at all.
      sendAmountMinor: Number(r.send_amount_minor),
      sendCurrency: r.send_currency,
      highValue: BigInt(r.send_amount_minor) >= HIGH_VALUE_TRANSFER_MINOR,
      createdAt: r.created_at
    }));

    const summary: FraudRiskEvidenceSummary = {
      openSafetyReportCount: safetyReports.filter((r) => r.open).length,
      highValueTransferCount: transfers.filter((t) => t.highValue).length,
      unverifiedPaymentMethodCount: paymentMethods.filter((p) => !p.verified).length,
      userSuspended: userStatus === "SUSPENDED"
    };

    const maxScore = riskScoreR.rows[0]?.maxScore;

    return {
      caseId: supportCase.id,
      caseNumber: supportCase.case_number,
      userId,
      caseState: supportCase.state,
      priority: supportCase.priority,
      evidence: {
        user: { status: userStatus, suspended: summary.userSuspended },
        risk: {
          level: deriveFraudRiskLevel(safetyReports, userStatus),
          score: maxScore == null ? null : Number(maxScore)
        },
        safetyReports,
        paymentMethods,
        transfers,
        summary
      },
      review: reviewR.rows[0] ?? null
    };
  }
}
