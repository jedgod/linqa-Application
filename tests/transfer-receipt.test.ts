import test from "node:test";
import assert from "node:assert/strict";
import { receiptRows, receiptShareText, referenceId } from "../clients/mobile/services/transfer-receipt.ts";

const base = {
  id: "trf_01hxabcdef1234", sendAmountMinor: "30000", sendCurrency: "USD", receiveAmountMinor: "531900", receiveCurrency: "GHS",
  recipientName: "Kwame Mensah", customerRate: "17.73", completedAt: "2026-10-12T15:42:00Z", createdAt: "2026-10-12T15:40:00Z"
};

test("receipt rows show sent, received, rate, date and reference", () => {
  const rows = receiptRows({ ...base, direction: "SENT" });
  assert.deepEqual(rows.map((r) => r.label), ["You Sent", "They Received", "Exchange Rate", "Date & Time", "Reference ID"]);
  assert.equal(rows[0].value, "$300.00");
  assert.equal(rows[1].value, "5,319.00 GHS");
  assert.equal(rows[2].value, "1 USD = 17.73 GHS");
});

test("received receipts use receiver wording and omit the rate", () => {
  const rows = receiptRows({ ...base, direction: "RECEIVED", customerRate: null, receiveCurrency: "USD", receiveAmountMinor: "30000" });
  assert.equal(rows[0].label, "They Sent");
  assert.equal(rows[1].label, "You Received");
  assert.ok(!rows.some((r) => r.label === "Exchange Rate"));
});

test("same-currency transfers have no exchange rate row", () => {
  assert.ok(!receiptRows({ ...base, receiveCurrency: "USD", customerRate: "1" }).some((r) => r.label === "Exchange Rate"));
});

test("reference id is stable and share text names the counterparty", () => {
  assert.equal(referenceId(base.id), referenceId(base.id));
  assert.match(referenceId(base.id), /^LQ-[A-Z0-9]{1,10}$/);
  const text = receiptShareText(base);
  assert.match(text, /To: Kwame Mensah/);
  assert.match(text, /Reference ID: LQ-/);
});

test("small amounts keep two decimals", () => {
  assert.equal(receiptRows({ ...base, sendAmountMinor: "5" })[0].value, "$0.05");
});
