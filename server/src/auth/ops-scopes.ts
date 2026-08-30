// Scope constants for the admin/staff operations surface
// (server/src/routes/operations/index.ts). These are ordinary entries in the
// same space-delimited `scope` JWT claim every other route already checks
// via requireScope() in jwt.ts -- there is no separate role field or second
// auth system here, on purpose.

export const OPS_SCOPES = [
  "ops:dashboard:read",
  "ops:staff:read",
  "ops:case:read",
  "ops:case:assign",
  "ops:case:release",
  "ops:case:note",
  "ops:case:resolve",
  "ops:case:priority",
  "ops:case:reply",
  "ops:client360:read",
  "ops:recovery:read",
  "ops:recovery:review",
  "ops:recovery:approve",
  "ops:risk:read",
  "ops:risk:review",
  "ops:risk:approve",
  "ops:linqasend:read",
  "ops:linqasend:review",
  "ops:linqasend:approve"
] as const;

export type OpsScope = (typeof OPS_SCOPES)[number];

// ops_staff_profiles.staff_role (028_repo_native_operations.sql) is plain
// TEXT with no CHECK constraint, so adding a role here is additive and
// doesn't need a migration. RECOVERY_SPECIALIST is a distinct job function
// from SUPPORT_AGENT -- see Admin-Staff/Admin-Staff_page/
// Linqa_Repo_Native_Recovery_Specialist_Review_Approval_Pack.txt, which
// designed the whole review/approve split around a specialist role that
// didn't exist in this file yet.
// FRAUD_ANALYST and FINANCE_OPS come from the fraud & risk and LinqaSend
// investigation packs in the same directory, and are distinct job functions
// again: a fraud analyst rules on safety/abuse evidence, a finance ops
// reviewer rules on transaction evidence. Neither is a superset of the other
// and neither is general casework.
export type StaffRole =
  | "OPS_ADMIN"
  | "SUPERVISOR"
  | "SUPPORT_AGENT"
  | "RECOVERY_SPECIALIST"
  | "FRAUD_ANALYST"
  | "FINANCE_OPS";

export const STAFF_ROLE_SCOPES: Record<StaffRole, OpsScope[]> = {
  OPS_ADMIN: [...OPS_SCOPES],
  // Supervisors can review recovery evidence and reject/escalate, but the
  // pack's own suggested grants leave ops:recovery:approve out of the
  // default SUPERVISOR/OPS_ADMIN grant unless that's an explicit policy
  // choice -- OPS_ADMIN gets it here only because OPS_ADMIN is already the
  // full-access role via the OPS_SCOPES spread above, not because this list
  // grants it directly.
  SUPERVISOR: [
    "ops:dashboard:read",
    "ops:staff:read",
    "ops:case:read",
    "ops:case:assign",
    "ops:case:release",
    "ops:case:note",
    "ops:case:resolve",
    "ops:case:priority",
    "ops:case:reply",
    "ops:client360:read",
    "ops:recovery:read",
    "ops:recovery:review",
    // Same read/review-but-not-approve shape for the two newer specialist
    // workflows: a supervisor can rule on evidence and reject or escalate,
    // but signing off an APPROVED fraud or transaction review stays with the
    // specialist role whose job it is.
    "ops:risk:read",
    "ops:risk:review",
    "ops:linqasend:read",
    "ops:linqasend:review"
  ],
  // Agents can move their own cases through state (OPEN -> WAITING_USER ->
  // RESOLVED, etc.), reply to the client, and pull the read-only Client 360
  // and recovery-evidence context as part of normal casework, but
  // reprioritizing and recovery review/approval are left to specialists and
  // supervisors/admins so P1/URGENT can't be unilaterally downgraded and
  // account-recovery approval isn't a unilateral agent call.
  SUPPORT_AGENT: [
    "ops:case:read",
    "ops:case:assign",
    "ops:case:release",
    "ops:case:note",
    "ops:case:resolve",
    "ops:case:reply",
    "ops:client360:read",
    "ops:recovery:read",
    // Agents get the fraud/risk read as the pack suggests -- safety-report
    // context is already partly visible to them through Client 360's risk
    // block, so this is the same information in more detail. They
    // deliberately do NOT get ops:linqasend:read: unlike Client 360's
    // LinqaSend summary (enabled / account state / hold count), the
    // investigation endpoint returns per-transfer amounts, currencies and
    // masked instrument references, which is finance-ops material.
    "ops:risk:read"
  ],
  // Recovery specialists still need to pick a case up (ops:case:assign) and
  // hand it back (ops:case:release) to reach it at all in the case
  // workspace UI -- every case view is reached through "my work" or
  // "assign to me", there's no read-only case-open path that skips
  // ownership. They keep ops:case:note for review-adjacent context, but not
  // resolve/priority/reply, which belong to general casework, a separate
  // job function from this pack's narrow "review evidence, record a
  // decision" scope.
  RECOVERY_SPECIALIST: [
    "ops:case:read",
    "ops:case:assign",
    "ops:case:release",
    "ops:case:note",
    "ops:recovery:read",
    "ops:recovery:review",
    "ops:recovery:approve"
  ],
  // Fraud analysts get the same case-reachability floor as recovery
  // specialists (read/assign/release/note) for the same reason -- the case
  // workspace has no read-only open path -- plus the full risk read/review/
  // approve set, which is their job function. No reply/resolve/priority:
  // ruling on abuse evidence is not general casework. No LinqaSend scopes
  // either; the risk endpoint already surfaces the transfer and payment-
  // method counts a fraud review needs, without per-transaction detail.
  FRAUD_ANALYST: [
    "ops:case:read",
    "ops:case:assign",
    "ops:case:release",
    "ops:case:note",
    "ops:risk:read",
    "ops:risk:review",
    "ops:risk:approve"
  ],
  // Finance ops mirrors FRAUD_ANALYST on the LinqaSend side. ops:risk:read
  // is included because a transaction investigation routinely turns on
  // whether the same account already has open safety reports, and that is
  // read-only context.
  FINANCE_OPS: [
    "ops:case:read",
    "ops:case:assign",
    "ops:case:release",
    "ops:case:note",
    "ops:risk:read",
    "ops:linqasend:read",
    "ops:linqasend:review",
    "ops:linqasend:approve"
  ]
};

export function scopesForStaffRole(role: StaffRole): OpsScope[] {
  return STAFF_ROLE_SCOPES[role] ?? [];
}

/*
Wherever this repo's JWTs get minted for a staff user (server/src/auth/jwt.ts
only verifies tokens -- issuing happens in the login/session flow), merge in:

  const opsScopes = staffRole ? scopesForStaffRole(staffRole) : [];
  payload.scope = [...new Set([...existingScopes, ...opsScopes])].join(" ");

Enforcement at the route stays the existing, single mechanism:

  const p = await auth(request);
  requireScope(p, "ops:case:assign");
*/
