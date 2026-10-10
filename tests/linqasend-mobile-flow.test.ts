import test from "node:test";
import assert from "node:assert/strict";
import { trackTransfer } from "../clients/mobile/services/transfer-tracking.ts";
import { SEND_COUNTRIES, findCountry, normalizePhone } from "../clients/mobile/services/linqasend-countries.ts";

const created = "2026-10-06T09:41:00.000Z";
const track = (status: string, extra: Partial<Parameters<typeof trackTransfer>[0]> = {}) => trackTransfer({ status, createdAt: created, completedAt: null, timeline: [], ...extra });
const states = (status: string, extra = {}) => track(status, extra).steps.map((s) => s.state);

test("tracking follows the real status through the five steps", () => {
  assert.deepEqual(states("CREATED"), ["done", "current", "pending", "pending", "pending"]);
  assert.deepEqual(states("RISK_REVIEW"), ["done", "current", "pending", "pending", "pending"]);
  assert.deepEqual(states("FUNDS_AUTHORIZED"), ["done", "done", "current", "pending", "pending"]);
  assert.deepEqual(states("PROCESSING"), ["done", "done", "current", "pending", "pending"]);
  assert.deepEqual(states("PAYOUT_PROCESSING"), ["done", "done", "done", "current", "pending"]);
  assert.deepEqual(states("COMPLETED"), ["done", "done", "done", "done", "done"]);
});

test("labels and copy match the design", () => {
  const t = track("PROCESSING");
  assert.deepEqual(t.steps.map((s) => s.label), ["Transfer Initiated", "Payment Confirmed", "Processing", "Payout On The Way", "Delivered"]);
  assert.equal(t.title, "Transfer in Progress");
  assert.equal(t.message, "We'll notify you when it's successfully delivered.");
  assert.equal(t.outcome, "IN_PROGRESS");
  assert.equal(track("COMPLETED").outcome, "DELIVERED");
  assert.equal(track("COMPLETED").title, "Transfer Complete");
});

test("times appear only where the transfer really reached that step", () => {
  const t = track("PROCESSING", { timeline: [{ phase: "FUNDING", status: "SUCCEEDED", at: "2026-10-06T09:42:00.000Z" }] });
  assert.equal(t.steps[0]!.at, created);
  assert.equal(t.steps[1]!.at, "2026-10-06T09:42:00.000Z");
  assert.equal(t.steps[3]!.at, null); // pending: no time invented
  assert.equal(track("COMPLETED", { completedAt: "2026-10-06T10:00:00.000Z" }).steps[4]!.at, "2026-10-06T10:00:00.000Z");
});

test("declined, canceled and failed transfers stop at a failed step and say so", () => {
  for (const status of ["DECLINED", "CANCELED", "EXPIRED", "FAILED"]) {
    const t = track(status);
    assert.equal(t.outcome, "STOPPED", status);
    assert.equal(t.steps.filter((s) => s.state === "failed").length, 1, status);
    assert.ok(!t.steps.some((s) => s.state === "current"), status);
    assert.match(t.message, /no money|could not|expired/i, status);
  }
  assert.deepEqual(states("DECLINED"), ["done", "failed", "pending", "pending", "pending"]);
});

test("manual review and holds are flagged as needing attention rather than progressing", () => {
  for (const status of ["MANUAL_REVIEW", "ON_HOLD", "REQUIRES_ACTION"]) {
    const t = track(status);
    assert.equal(t.outcome, "NEEDS_ATTENTION", status);
    assert.equal(t.title, "Transfer Needs Attention");
  }
});

test("phone numbers normalize to E.164 for the selected country", () => {
  assert.equal(normalizePhone("+233 24 123 4567", "233"), "+233241234567");
  assert.equal(normalizePhone("024 123 4567", "233"), "+233241234567");
  assert.equal(normalizePhone("00233241234567", "233"), "+233241234567");
  assert.equal(normalizePhone("+234 802 123 4567", "233"), null); // another country's code
  assert.equal(normalizePhone("12", "233"), null);
  assert.equal(normalizePhone("abc", "233"), null);
  assert.equal(normalizePhone("", "233"), null);
});

test("the country list is well formed", () => {
  const codes = SEND_COUNTRIES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length, "unique codes");
  for (const c of SEND_COUNTRIES) {
    assert.match(c.code, /^[A-Z]{2}$/);
    assert.match(c.currency, /^[A-Z]{3}$/);
    assert.match(c.dial, /^\d{1,3}$/);
    assert.ok(c.methods.length > 0, c.code);
  }
  assert.equal(findCountry("gh")?.currency, "GHS");
  assert.equal(findCountry("ZZ"), undefined);
});
