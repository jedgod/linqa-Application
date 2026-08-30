import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";
import { HIGH_VALUE_TRANSFER_MINOR } from "../linqasend/risk-engine.service.js";

// Adapted from Admin-Staff/Admin-Staff_page/
// Linqa_Repo_Native_LinqaSend_Transaction_Investigation_Specialist_Review_Pack.txt.
// Same column-guessing problem as the fraud & risk pack -- see the header of
// fraud-risk-evidence.service.ts. Specific to this one:
//
//   the pack's `amount` / `send_amount` / `source_amount` chain misses the
//   real send_amount_minor (minor units), so its 1000 threshold compared
//   0 >= 1000 on every row;
//   `masked_pan` / `masked_account` don't exist -- the masked instrument
//   reference is last4;
//   `exchange_rate` / `fx_rate` don't exist -- the rate is customer_rate;
//   and its status list checks "CANCELLED", which is not a value of
//   linqasend_transfer_status ("CANCELED", one L), so it would never match.

export type LinqaSendPaymentMethodEvidence = {
  id: string;
  type: string;
  verificationStatus: string;
  verified: boolean;
  maskedReference: string | null;
  internationalEnabled: boolean;
};

export type TransferAttention = "NORMAL" | "REVIEW" | "HIGH";

export type LinqaSendTransferEvidence = {
  id: string;
  publicId: string;
  status: string;
  direction: "SENT" | "RECEIVED";
  sendAmountMinor: number;
  sendCurrency: string;
  receiveAmountMinor: number;
  receiveCurrency: string;
  customerRate: string | null;
  paymentMethodId: string | null;
  paymentMethodVerified: boolean | null;
  failureCode: string | null;
  attention: TransferAttention;
  createdAt: string;
};

export type LinqaSendEvidenceSummary = {
  paymentMethodCount: number;
  verifiedPaymentMethodCount: number;
  transferCount: number;
  attentionTransferCount: number;
  failedTransferCount: number;
};

// Terminal states where the money did not land as intended, or landed and was
// clawed back. These are what an investigator opens a case about.
const FAILED_STATUSES = new Set(["FAILED", "REVERSED", "DECLINED", "DISPUTED", "CHARGEBACK"]);

// The states the transfer pipeline itself parks a transfer in for a human --
// the same three client360.service.ts already counts as activeHoldCount, plus
// REQUIRES_ACTION. CANCELED and EXPIRED are deliberately not here: the pack
// grouped cancellation with failure, but in this schema they are ordinary
// benign endings, and flagging every one of them would bury the real signals.
const HELD_STATUSES = new Set(["ON_HOLD", "MANUAL_REVIEW", "RISK_REVIEW", "REQUIRES_ACTION"]);

export function deriveTransferAttention(input: {
  status: string;
  sendAmountMinor: bigint;
  paymentMethodVerified: boolean | null;
}): TransferAttention {
  if (FAILED_STATUSES.has(input.status)) return "HIGH";
  if (HELD_STATUSES.has(input.status)) return "REVIEW";
  if (input.paymentMethodVerified === false) return "REVIEW";
  if (input.sendAmountMinor >= HIGH_VALUE_TRANSFER_MINOR) return "REVIEW";
  return "NORMAL";
}

const EMPTY_SUMMARY: LinqaSendEvidenceSummary = {
  paymentMethodCount: 0,
  verifiedPaymentMethodCount: 0,
  transferCount: 0,
  attentionTransferCount: 0,
  failedTransferCount: 0
};

export class LinqaSendEvidenceService {
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
        evidence: { paymentMethods: [], transfers: [], summary: EMPTY_SUMMARY },
        review: null
      };
    }

    const [pmR, trR, reviewR] = await Promise.all([
      this.db.query(
        `SELECT id, type, verification_status, last4, international_enabled
         FROM linqasend_payment_methods
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
        [userId]
      ),
      this.db.query(
        `SELECT t.id, t.public_id, t.status::text AS status,
                t.send_amount_minor, t.send_currency,
                t.receive_amount_minor, t.receive_currency,
                t.customer_rate, t.payment_method_id, t.failure_code, t.created_at,
                (t.user_id = $1) AS "isSender"
         FROM linqasend_transfers t
         LEFT JOIN linqasend_recipients r ON r.id = t.recipient_id
         WHERE t.user_id = $1 OR r.linqa_user_id = $1
         ORDER BY t.created_at DESC
         LIMIT 100`,
        [userId]
      ),
      this.db.query(
        `SELECT id, decision, reviewer_user_id AS "reviewerUserId",
                specialist_note AS "specialistNote", reason_code AS "reasonCode",
                evidence_snapshot AS "evidenceSnapshot", reviewed_at AS "reviewedAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM ops_linqasend_reviews_v1
         WHERE case_id = $1
         LIMIT 1`,
        [caseId]
      )
    ]);

    const paymentMethods: LinqaSendPaymentMethodEvidence[] = pmR.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      verificationStatus: r.verification_status,
      verified: r.verification_status === "VERIFIED",
      maskedReference: r.last4 ? `••••${String(r.last4).trim()}` : null,
      internationalEnabled: r.international_enabled
    }));

    const verifiedById = new Map(paymentMethods.map((p) => [p.id, p.verified]));

    const transfers: LinqaSendTransferEvidence[] = trR.rows.map((r: any) => {
      // pg returns bigint as a string; minor units stay inside Number's safe
      // range for the payload, but the threshold compare stays in BigInt.
      const sendAmountMinor = BigInt(r.send_amount_minor);
      // A transfer's payment method belongs to the sender. On a received
      // transfer the instrument is the counterparty's and isn't in this
      // user's payment-method set, so "unverified" is unknown, not false.
      const paymentMethodVerified = r.payment_method_id ? verifiedById.get(r.payment_method_id) ?? null : null;

      return {
        id: r.id,
        publicId: r.public_id,
        status: r.status,
        direction: r.isSender ? ("SENT" as const) : ("RECEIVED" as const),
        sendAmountMinor: Number(r.send_amount_minor),
        sendCurrency: r.send_currency,
        receiveAmountMinor: Number(r.receive_amount_minor),
        receiveCurrency: r.receive_currency,
        customerRate: r.customer_rate == null ? null : String(r.customer_rate),
        paymentMethodId: r.payment_method_id ?? null,
        paymentMethodVerified,
        failureCode: r.failure_code ?? null,
        attention: deriveTransferAttention({ status: r.status, sendAmountMinor, paymentMethodVerified }),
        createdAt: r.created_at
      };
    });

    const summary: LinqaSendEvidenceSummary = {
      paymentMethodCount: paymentMethods.length,
      verifiedPaymentMethodCount: paymentMethods.filter((p) => p.verified).length,
      transferCount: transfers.length,
      attentionTransferCount: transfers.filter((t) => t.attention !== "NORMAL").length,
      failedTransferCount: transfers.filter((t) => FAILED_STATUSES.has(t.status)).length
    };

    return {
      caseId: supportCase.id,
      caseNumber: supportCase.case_number,
      userId,
      caseState: supportCase.state,
      priority: supportCase.priority,
      evidence: { paymentMethods, transfers, summary },
      review: reviewR.rows[0] ?? null
    };
  }
}
