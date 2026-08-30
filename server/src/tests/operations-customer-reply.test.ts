import { describe, expect, it } from "vitest";
import { canReplyToCase } from "../services/operations/case-messages.service.js";

describe("operations: customer reply eligibility", () => {
  it("allows replying to OPEN, WAITING_USER, WAITING_INTERNAL and RESOLVED cases", () => {
    expect(canReplyToCase("OPEN")).toBe(true);
    expect(canReplyToCase("WAITING_USER")).toBe(true);
    expect(canReplyToCase("WAITING_INTERNAL")).toBe(true);
    expect(canReplyToCase("RESOLVED")).toBe(true);
  });

  it("rejects replying to a CLOSED case", () => {
    expect(canReplyToCase("CLOSED")).toBe(false);
  });
});

// The rest needs a real Postgres fixture (transactional insert + delivery
// adapter + event/audit writes) that this repo doesn't have a harness for
// yet -- see server/src/tests/operations.test.ts for the same honest gap on
// assignment/state-change. Marked todo rather than mocked to avoid a false
// sense of coverage.
describe.todo("operations: customer reply (needs Postgres fixture)", () => {
  it.todo("requires ops:case:reply");
  it.todo("persists a STAFF_TO_CLIENT message before attempting delivery");
  it.todo("writes ops.case.reply_queued / _sent events and an ops_audit_events row");
  it.todo("uses the real RealtimeHub transport via ExistingHubSupportReplyDelivery");
  it.todo("marks delivery_status SENT on accepted delivery");
  it.todo("marks delivery_status FAILED but keeps the message row on delivery failure");
  it.todo("rejects a CLOSED case with 409");
  it.todo("rejects a case with no linked client (user_id null) with 409");
  it.todo("message history never includes internal notes or private events");
});
