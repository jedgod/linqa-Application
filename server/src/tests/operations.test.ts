import { describe, expect, it } from "vitest";
import { isWorkableState, assignmentRejectionReason } from "../services/operations/case-assignment.service.js";
import { isValidCaseState, isValidCasePriority } from "../services/operations/case-state.service.js";

describe("operations: case assignment eligibility", () => {
  it("treats OPEN, WAITING_USER and WAITING_INTERNAL as workable", () => {
    expect(isWorkableState("OPEN")).toBe(true);
    expect(isWorkableState("WAITING_USER")).toBe(true);
    expect(isWorkableState("WAITING_INTERNAL")).toBe(true);
  });

  it("treats RESOLVED and CLOSED as not workable", () => {
    expect(isWorkableState("RESOLVED")).toBe(false);
    expect(isWorkableState("CLOSED")).toBe(false);
  });

  it("treats an unknown state as not workable (fail closed)", () => {
    expect(isWorkableState("SOMETHING_ELSE")).toBe(false);
  });
});

describe("operations: staff assignment eligibility (capacity/presence boundary)", () => {
  const base = { suspended: false, presence: "AVAILABLE" as const, activeCaseCount: 3, maxConcurrentCases: 8 };

  it("accepts an available, non-suspended staff member under capacity", () => {
    expect(assignmentRejectionReason(base)).toBeNull();
  });

  it("rejects a suspended staff member regardless of capacity or presence", () => {
    expect(assignmentRejectionReason({ ...base, suspended: true })).toBe("STAFF_SUSPENDED");
  });

  it("rejects OFFLINE presence", () => {
    expect(assignmentRejectionReason({ ...base, presence: "OFFLINE" })).toBe("STAFF_OFFLINE");
  });

  it("accepts BUSY and AWAY presence (only OFFLINE is disqualifying)", () => {
    expect(assignmentRejectionReason({ ...base, presence: "BUSY" })).toBeNull();
    expect(assignmentRejectionReason({ ...base, presence: "AWAY" })).toBeNull();
  });

  it("accepts exactly one case below the capacity limit", () => {
    expect(assignmentRejectionReason({ ...base, activeCaseCount: 7, maxConcurrentCases: 8 })).toBeNull();
  });

  it("rejects at exactly the capacity limit (>=, not >)", () => {
    expect(assignmentRejectionReason({ ...base, activeCaseCount: 8, maxConcurrentCases: 8 })).toBe("STAFF_CAPACITY_REACHED");
  });

  it("rejects over the capacity limit", () => {
    expect(assignmentRejectionReason({ ...base, activeCaseCount: 9, maxConcurrentCases: 8 })).toBe("STAFF_CAPACITY_REACHED");
  });

  it("checks suspended before presence before capacity, in that order", () => {
    // A suspended + offline + over-capacity staff member should report
    // suspension first -- callers only get one reason and it should be the
    // most fundamental one.
    expect(assignmentRejectionReason({ suspended: true, presence: "OFFLINE", activeCaseCount: 99, maxConcurrentCases: 1 })).toBe(
      "STAFF_SUSPENDED"
    );
  });
});

describe("operations: case workspace state/priority validation", () => {
  it("accepts all five real support_cases_v2 state values", () => {
    for (const s of ["OPEN", "WAITING_USER", "WAITING_INTERNAL", "RESOLVED", "CLOSED"]) {
      expect(isValidCaseState(s)).toBe(true);
    }
  });

  it("rejects values from the pack's assumed (wrong) state enum", () => {
    // The original pack's routes/services assumed NEW/QUEUED/ASSIGNED/
    // IN_PROGRESS/ESCALATED -- none of those are real support_cases_v2
    // states (018_ga_hardening.sql). Pinning the rejection here so a
    // future edit can't silently reintroduce that mismatch.
    for (const s of ["NEW", "QUEUED", "ASSIGNED", "IN_PROGRESS", "ESCALATED"]) {
      expect(isValidCaseState(s)).toBe(false);
    }
  });

  it("accepts all four real support_cases_v2 priority values", () => {
    for (const p of ["LOW", "NORMAL", "HIGH", "URGENT"]) {
      expect(isValidCasePriority(p)).toBe(true);
    }
  });

  it("rejects P1-P4 style priorities (not what this schema uses)", () => {
    for (const p of ["P1", "P2", "P3", "P4"]) {
      expect(isValidCasePriority(p)).toBe(false);
    }
  });
});

// Everything in this block needs a real Postgres instance with migrations
// through 029 applied -- there is no DB-backed test harness anywhere in
// server/src/tests/ today (confirmed: no file in this directory opens a
// Pool or reads DATABASE_URL), so these are genuine gaps in the repo's
// test infrastructure, not something specific to this slice. Registering
// them as it.todo() keeps them visible in `vitest run` output (as pending,
// not passing) instead of only living in a comment someone can miss.
describe.todo("operations: concurrency (needs a real Postgres fixture harness)", () => {
  it.todo(
    "two concurrent assign() calls for the same case: exactly one wins, the loser sees " +
      "CASE_NOT_ASSIGNABLE or the case is already owned by someone else, and " +
      "ops_case_assignments_v2 never has two active (released_at IS NULL) rows for one " +
      "case_id -- this is what uq_ops_case_assignments_v2_active exists to guarantee under " +
      "a real transaction, and only means something under real row locking"
  );

  it.todo(
    "release() racing a reassign() to a different staff member: the release must not clear " +
      "an assignment a concurrent reassign just wrote (release() should be a no-op if the " +
      "case is no longer owned by who the caller thought)"
  );

  it.todo(
    "assign() at exactly max_concurrent_cases, called twice concurrently for two different " +
      "cases against the same staff member: at most one should succeed, active_case_count " +
      "must never exceed max_concurrent_cases even under a race (this is what FOR UPDATE on " +
      "ops_staff_profiles is for)"
  );

  it.todo(
    "assign() to a staff member who goes OFFLINE or gets suspended in the moment between the " +
      "route reading scopes and the transaction acquiring the row lock -- the FOR UPDATE read " +
      "inside the transaction, not a pre-check, must be what's authoritative"
  );

  it.todo(
    "if the ops_audit_events insert fails partway through assign()'s transaction (e.g. a " +
      "constraint violation), the whole transaction rolls back -- support_cases_v2." +
      "assigned_staff_id, ops_case_assignments_v2 and ops_staff_profiles.active_case_count " +
      "must all revert together, not partially commit"
  );

  it.todo("resolves GET /staff/me from principal.userId (not principal.subject)");

  it.todo(
    "POST a note, then GET the case: the note appears via InternalNotesService.list() and a " +
      "matching support_case_events_v2 row (event_type ops.case.note_added, private=true) " +
      "exists for the same case_id"
  );

  it.todo("rejects POST /cases/:caseId/notes for a caller without ops:case:note (403)");

  it.todo("rejects PATCH .../state and PATCH .../priority with an out-of-enum value (400, INVALID_CASE_STATE / INVALID_CASE_PRIORITY)");

  it.todo(
    "PATCH .../state to RESOLVED sets support_cases_v2.resolved_at, and the dashboard's " +
      "resolvedToday count picks it up on the same day -- this is what makes the 'Resolved " +
      "Today' KPI on the real dashboard actually move"
  );

  it.todo(
    "if the ops_audit_events insert fails partway through CaseStateService.change()'s " +
      "transaction, support_cases_v2.state/priority rolls back to its prior value -- the " +
      "event insert (via SupportOperationsService.addEvent) happens only after COMMIT, so it " +
      "must not fire when the transaction rolled back"
  );
});
