import assert from "node:assert/strict";
import { estimateFee, type FeeSchedules } from "./wallet-fees";
import { invoicePayload, maskInvoiceCode, parseInvoiceInput, qrMatrix, qrPath } from "./wallet-stealthpay";

// Codes: only well-formed invoice codes are accepted, from a typed value or a scanned QR.
assert.equal(parseInvoiceInput("inv_st1Demo9x3p"), "inv_st1Demo9x3p");
assert.equal(parseInvoiceInput("  inv_st1Demo9x3p \n"), "inv_st1Demo9x3p");
assert.equal(parseInvoiceInput(invoicePayload("inv_st1Demo9x3p")), "inv_st1Demo9x3p");
for (const bad of ["", "inv_", "inv_short", "INV_st1Demo9x3p", "https://example.com/pay?x=1", "linqa-invoice:", "linqa-invoice:../etc/passwd", "inv_st1 Demo9x3p", "bitcoin:bc1qxyz", "inv_" + "a".repeat(65)]) {
  assert.equal(parseInvoiceInput(bad), null, `rejects ${JSON.stringify(bad)}`);
}

// Display: long codes are shortened, short ones left alone, and the mask never exposes the middle.
assert.equal(maskInvoiceCode("inv_st1abcdefghijk9x3p"), "inv_st1...9x3p");
assert.equal(maskInvoiceCode("inv_short1"), "inv_short1");
assert.ok(!maskInvoiceCode("inv_st1abcdefghijk9x3p").includes("defgh"));

// QR: square, deterministic, finder patterns in three corners, different payloads differ, path encodes every dark module.
const a = qrMatrix(invoicePayload("inv_st1Demo9x3p")), b = qrMatrix(invoicePayload("inv_st1Demo9x3p")), c = qrMatrix(invoicePayload("inv_st1Other9x3p"));
assert.ok(a.length >= 21 && a.every((row) => row.length === a.length));
assert.deepEqual(a, b);
assert.notDeepEqual(a, c);
const n = a.length;
for (const [r, col] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
  assert.ok(a[r]![col]! && a[r]![col + 6]! && a[r + 6]![col]! && a[r + 6]![col + 6]!, "finder pattern corners are dark");
}
const dark = a.flat().filter(Boolean).length;
assert.equal((qrPath(a).match(/M/g) ?? []).length, dark);

// The invoice fee is the platform's internal send fee: $24.50 base -> $2.45 fee -> $26.95 total.
const schedules: FeeSchedules = { USD: { INTERNAL: { bps: 1000, minMinor: "45" } } };
const fee = estimateFee(schedules, "INTERNAL", "USD", "2450")!;
assert.deepEqual([fee.feeMinor, fee.totalMinor, fee.minimumApplied], [245n, 2695n, false]);
assert.equal(estimateFee(schedules, "INTERNAL", "USD", "100")!.minimumApplied, true);
console.log("wallet-stealthpay: ok");
