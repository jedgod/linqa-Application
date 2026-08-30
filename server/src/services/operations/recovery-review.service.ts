import type { Database } from "../../db/pool.js";
import { SupportOperationsService } from "../support-operations.service.js";
import { RecoveryEvidenceService } from "./recovery-evidence.service.js";
import { OpsHttpError, canReviewCase, type SpecialistDecision } from "./specialist-review.js";
import type { OpsScope } from "../../auth/ops-scopes.js";

export type RecoveryDecision = SpecialistDecision;

// Re-exported so existing callers and operations-recovery-specialist.test.ts
// keep importing the case-eligibility rule from here; it now lives in
// specialist-review.ts because the fraud & risk and LinqaSend reviews share it.
export { canReviewCase };

// APPROVED is the highest-impact decision in this narrow review-only
// workflow (see the pack's README: it's an operations decision record, not
// a credential mutation) -- require the stronger approval scope only for
// that branch. Factored out so the route and any future caller agree on
// the rule without duplicating it, and so it's unit-testable.
export function requiredScopeForDecision(decision: RecoveryDecision): OpsScope {
  return decision === "APPROVED" ? "ops:recovery:approve" : "ops:recovery:review";
}

export class RecoveryReviewService {
  private readonly evidence: RecoveryEvidenceService;
  private readonly support: SupportOperationsService;

  constructor(private readonly db: Database) {
    this.evidence = new RecoveryEvidenceService(db);
    this.support = new SupportOperationsService(db);
  }

  async saveReview(input: {
    caseId: string;
    reviewerUserId: string;
    reviewerScopes: string[];
    decision: RecoveryDecision;
    specialistNote: string;
    reasonCode: string;
    requestId?: string | null;
  }) {
    const evidencePayload = await this.evidence.getForCase(input.caseId);
    if (!evidencePayload) throw new OpsHttpError("CASE_NOT_FOUND", 404);
    if (!evidencePayload.userId) throw new OpsHttpError("CASE_HAS_NO_CLIENT", 409);
    if (!canReviewCase(evidencePayload.caseState)) throw new OpsHttpError("CASE_CLOSED", 409);

    const client = await this.db.connect();
    let review: any;

    try {
      await client.query("BEGIN");

      const before = await client.query(
        `SELECT id, decision, reviewer_user_id AS "reviewerUserId", specialist_note AS "specialistNote",
                reason_code AS "reasonCode", reviewed_at AS "reviewedAt"
         FROM ops_recovery_reviews_v1
         WHERE case_id = $1
         FOR UPDATE`,
        [input.caseId]
      );

      const inserted = await client.query(
        `INSERT INTO ops_recovery_reviews_v1(
           case_id, user_id, reviewer_user_id, decision, evidence_snapshot, specialist_note, reason_code, reviewed_at
         ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,now())
         ON CONFLICT (case_id) DO UPDATE SET
           reviewer_user_id = EXCLUDED.reviewer_user_id,
           decision = EXCLUDED.decision,
           evidence_snapshot = EXCLUDED.evidence_snapshot,
           specialist_note = EXCLUDED.specialist_note,
           reason_code = EXCLUDED.reason_code,
           reviewed_at = now(),
           updated_at = now()
         RETURNING id, case_id AS "caseId", user_id AS "userId", reviewer_user_id AS "reviewerUserId",
                   decision, evidence_snapshot AS "evidenceSnapshot", specialist_note AS "specialistNote",
                   reason_code AS "reasonCode", reviewed_at AS "reviewedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          input.caseId,
          evidencePayload.userId,
          input.reviewerUserId,
          input.decision,
          JSON.stringify(evidencePayload.evidence),
          input.specialistNote,
          input.reasonCode
        ]
      );
      review = inserted.rows[0];

      await client.query(
        `INSERT INTO ops_audit_events(actor_user_id, actor_scope_snapshot, action, resource_type, resource_id, reason_code, request_id, before_json, after_json)
         VALUES($1,$2::jsonb,'ops.recovery.review.decision','support_case_v2',$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          input.reviewerUserId,
          JSON.stringify(input.reviewerScopes),
          input.caseId,
          input.reasonCode,
          input.requestId ?? null,
          JSON.stringify(before.rows[0] ?? null),
          JSON.stringify(review)
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.support.addEvent({
      caseId: input.caseId,
      actorType: "STAFF",
      actorId: input.reviewerUserId,
      eventType: "ops.recovery.review_decision",
      body: `Recovery specialist decision: ${input.decision}. Reason: ${input.reasonCode}`
    });

    return review;
  }
}
