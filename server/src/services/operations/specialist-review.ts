// Shared vocabulary for the specialist evidence-review workflows
// (recovery, fraud & risk, LinqaSend). Each of those is a separate job
// function with its own scopes, table and endpoints, but they are the same
// shape of workflow: read evidence the specialist may not mutate, then
// record APPROVED / REJECTED / ESCALATED with a rationale.
//
// Extracted when the fraud & risk and LinqaSend packs landed -- OpsHttpError
// was already copy-pasted into client360.service.ts and
// recovery-review.service.ts, and those two packs would have made four
// identical copies of it.

export type SpecialistDecision = "APPROVED" | "REJECTED" | "ESCALATED";

export class OpsHttpError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

// support_cases_v2 has no "ASSIGNED"/"QUEUED" step -- CLOSED is the only
// state a specialist decision can't be recorded against, matching
// canReplyToCase in case-messages.service.ts. Shared by all three specialist
// workflows so they can't drift apart on what "still reviewable" means.
export function canReviewCase(state: string): boolean {
  return state !== "CLOSED";
}
