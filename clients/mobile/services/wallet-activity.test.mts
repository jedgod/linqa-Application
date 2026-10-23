import assert from "node:assert/strict";
import type { WalletMoneyOperation } from "./wallet.service";
import { applyQuery, dateGroup, describeOperation, groupByDate, isIncoming, matchesFilter, periodTotals, statusKey, summaryCurrency } from "./wallet-activity";

const now = new Date(2026, 9, 22, 15, 0, 0); // Thu Oct 22 2026, 3pm local
const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 22 - daysAgo, hour, 0, 0).toISOString();
let n = 0;
function op(kind: WalletMoneyOperation["kind"], direction: "SENT" | "RECEIVED", status: string, daysAgo: number, over: { amount?: string; fee?: string; currency?: string; target?: string } = {}): WalletMoneyOperation {
  const amount = over.amount ?? "2500", fee = over.fee ?? "0", currency = over.currency ?? "USD";
  return {
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, kind, status, direction, action_url: null, returned_minor: "0", created_at: at(daysAgo),
    snapshot: { id: "x", kind, walletId: "w", amountMinor: amount, feeMinor: fee, totalMinor: (BigInt(amount) + BigInt(fee)).toString(), currency, receiveAmountMinor: amount, receiveCurrency: currency, estimatedArrival: "", fxRate: "1", expiresAt: at(0), targetId: over.target ?? "t0" }
  } as WalletMoneyOperation;
}

// Classification
const received = op("INTERNAL", "RECEIVED", "COMPLETED", 0), sentInternal = op("INTERNAL", "SENT", "COMPLETED", 1), sentExternal = op("EXTERNAL", "SENT", "COMPLETED", 2);
const topup = op("TOPUP", "SENT", "COMPLETED", 3), cashOut = op("WITHDRAW", "SENT", "COMPLETED", 4);
assert.deepEqual([received, sentInternal, sentExternal, topup, cashOut].map(isIncoming), [true, false, false, true, false]);
assert.deepEqual([received, sentInternal, sentExternal, topup, cashOut].map((o) => matchesFilter(o, "RECEIVED")), [true, false, false, false, false]);
assert.deepEqual([received, sentInternal, sentExternal, topup, cashOut].map((o) => matchesFilter(o, "SENT")), [false, true, true, false, false]);
assert.deepEqual([received, sentInternal, sentExternal, topup, cashOut].map((o) => matchesFilter(o, "BANK")), [false, false, false, true, true]);

// Status: unknown/in-flight is Pending, never Completed
assert.equal(statusKey("COMPLETED"), "COMPLETED");
assert.equal(statusKey("QUEUED"), "PENDING");
assert.equal(statusKey("RECONCILING"), "PENDING");
assert.equal(statusKey("SOMETHING_NEW"), "PENDING");
assert.equal(statusKey("FAILED"), "FAILED");
assert.equal(statusKey("RETURNED"), "REVERSED");
assert.equal(statusKey("RETURN_REVIEW"), "REVERSED");

// Date grouping around midnight and the week boundary
assert.equal(dateGroup(new Date(2026, 9, 22, 0, 0, 1).toISOString(), now), "Today");
assert.equal(dateGroup(new Date(2026, 9, 21, 23, 59, 59).toISOString(), now), "Yesterday");
assert.equal(dateGroup(at(2), now), "This week");
assert.equal(dateGroup(at(6), now), "This week");
assert.equal(dateGroup(at(7), now), "Earlier");
assert.equal(dateGroup(new Date(2026, 9, 23, 9, 0, 0).toISOString(), now), "Today"); // clock skew
assert.deepEqual(groupByDate([{ created_at: at(9) }, { created_at: at(0) }, { created_at: at(1) }], now).map((g) => g.title), ["Today", "Yesterday", "Earlier"]);

// Descriptions use known recipient names, never invent one
const names = new Map([["t-alex", "Alex"], ["t-bank", "Account ending 4821"]]);
assert.equal(describeOperation(op("INTERNAL", "SENT", "COMPLETED", 0, { target: "t-alex" }), names), "Sent to Alex");
assert.equal(describeOperation(op("WITHDRAW", "SENT", "COMPLETED", 0, { target: "t-bank" }), names), "Cash out to Account ending 4821");
assert.equal(describeOperation(op("INTERNAL", "RECEIVED", "COMPLETED", 0, { target: "t-alex" }), names), "Received from a Linqa user");
assert.equal(describeOperation(op("EXTERNAL", "SENT", "COMPLETED", 0), names), "Sent outside Linqa");

// Totals: completed only, one currency, in the period; outgoing counts the fee
const items = [
  op("TOPUP", "SENT", "COMPLETED", 1, { amount: "30000" }),
  op("INTERNAL", "RECEIVED", "COMPLETED", 0, { amount: "5000" }),
  op("INTERNAL", "SENT", "COMPLETED", 2, { amount: "2500", fee: "250" }),
  op("WITHDRAW", "SENT", "QUEUED", 1, { amount: "9900" }),       // pending: excluded
  op("EXTERNAL", "SENT", "FAILED", 1, { amount: "7700" }),       // failed: excluded
  op("INTERNAL", "SENT", "COMPLETED", 1, { amount: "1000", currency: "EUR" }), // other currency
  op("WITHDRAW", "SENT", "COMPLETED", 40, { amount: "20000" })   // last month's activity
];
const month = periodTotals(items, "USD", "MONTH", now);
assert.equal(month.inMinor, 35000n);
assert.equal(month.outMinor, 2750n);
assert.equal(month.netMinor, 32250n);
assert.equal(month.count, 3);
assert.equal(periodTotals(items, "USD", "ANY", now).outMinor, 22750n);
assert.equal(periodTotals(items, "EUR", "MONTH", now).outMinor, 1000n);
assert.equal(summaryCurrency(items, null), "USD");
assert.equal(summaryCurrency([], "GBP"), "GBP");

// Filters combine, and search matches name or reference
const q = (over: Partial<Parameters<typeof applyQuery>[1]>) => ({ filter: "ALL" as const, status: "ANY" as const, period: "ANY" as const, text: "", ...over });
assert.equal(applyQuery(items, q({ filter: "BANK", status: "COMPLETED" }), names, now).length, 2);
assert.equal(applyQuery(items, q({ filter: "BANK", status: "PENDING" }), names, now).length, 1);
assert.equal(applyQuery(items, q({ period: "MONTH" }), names, now).length, 6);
assert.equal(applyQuery(items, q({ text: "cash out" }), names, now).length, 2);
assert.equal(applyQuery(items, q({ text: items[0]!.id.slice(-6) }), names, now).length, 1);
assert.equal(applyQuery(items, q({ text: "   " }), names, now).length, items.length);
console.log("wallet-activity: ok");
