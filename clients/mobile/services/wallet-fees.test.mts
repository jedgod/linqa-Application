import assert from "node:assert/strict";
import { estimateFee, type FeeSchedules } from "./wallet-fees";

// Same vectors as server/src/tests/wallet-fee-schedule.test.ts, so the preview cannot drift from the server.
const schedules: FeeSchedules = { USD: { INTERNAL: { bps: 1000, minMinor: "45" }, EXTERNAL: { bps: 1599, minMinor: "65" } } };
const vectors: Array<["INTERNAL" | "EXTERNAL", string, bigint, bigint]> = [
  ["INTERNAL", "100", 45n, 145n], ["INTERNAL", "450", 45n, 495n], ["INTERNAL", "455", 46n, 501n], ["INTERNAL", "2000", 200n, 2200n],
  ["EXTERNAL", "200", 65n, 265n], ["EXTERNAL", "406", 65n, 471n], ["EXTERNAL", "409", 65n, 474n], ["EXTERNAL", "410", 66n, 476n], ["EXTERNAL", "500", 80n, 580n]
];
for (const [kind, amount, fee, total] of vectors) {
  const e = estimateFee(schedules, kind, "USD", amount)!;
  assert.equal(e.feeMinor, fee, `${kind} ${amount} fee`);
  assert.equal(e.totalMinor, total, `${kind} ${amount} total`);
}
assert.equal(estimateFee(schedules, "INTERNAL", "USD", "100")!.minimumApplied, true);
assert.equal(estimateFee(schedules, "INTERNAL", "USD", "2000")!.minimumApplied, false);
assert.equal(estimateFee(schedules, "INTERNAL", "USD", "9007199254740993")!.feeMinor, 900719925474099n);
assert.equal(estimateFee(schedules, "INTERNAL", "EUR", "1000"), null);
assert.equal(estimateFee(null, "INTERNAL", "USD", "1000"), null);
assert.equal(estimateFee(schedules, "INTERNAL", "USD", "0"), null);
assert.equal(estimateFee(schedules, "INTERNAL", "USD", null), null);
console.log("wallet-fees: ok");
