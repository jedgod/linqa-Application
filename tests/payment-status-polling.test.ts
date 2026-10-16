import test from "node:test";
import assert from "node:assert/strict";
import { pollPaymentStatus } from "../clients/mobile/services/payment-status-polling.ts";

test("tracking recovers from network failure and stops only at a known terminal status", async () => {
  let calls = 0; const values: string[] = []; const delays: number[] = [];
  await pollPaymentStatus({ signal: new AbortController().signal,
    load: async () => { if (++calls === 1) throw new Error("offline"); return calls === 2 ? "PENDING" : "COMPLETED"; },
    onValue: value => values.push(value), onError: () => {}, terminal: value => value === "COMPLETED", wait: async ms => { delays.push(ms); }
  });
  assert.deepEqual(values, ["PENDING", "COMPLETED"]);
  assert.deepEqual(delays, [6000, 3000]);
});
test("repeated failures stop after five attempts without inventing a failed payment", async () => {
  let errors = 0; const values: unknown[] = [];
  await pollPaymentStatus({ signal: new AbortController().signal, load: async () => { throw new Error("offline"); }, onValue: v => values.push(v), onError: () => { errors++; }, terminal: () => false, wait: async () => {} });
  assert.equal(errors, 5); assert.deepEqual(values, []);
});
test("unmount abort suppresses a late response", async () => {
  const controller = new AbortController(); let updated = false;
  await pollPaymentStatus({ signal: controller.signal, load: async () => { controller.abort(); return "PENDING"; }, onValue: () => { updated = true; }, onError: () => {}, terminal: () => false });
  assert.equal(updated, false);
});
