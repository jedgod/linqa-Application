import test from "node:test";
import assert from "node:assert/strict";
import { detectBrand, formatCardNumber, formatExpiry, formatZip, isExpired, isValidCardNumber, isValidZip, parseExpiry, validateCardForm, cvvLength } from "../clients/mobile/services/card-input.ts";
import { getCardTokenizer } from "../clients/mobile/services/card-tokenizer.ts";

test("brand detection", () => {
  assert.equal(detectBrand("4242 4242 4242 4242"), "VISA");
  assert.equal(detectBrand("5555555555554444"), "MASTERCARD");
  assert.equal(detectBrand("2223003122003222"), "MASTERCARD");
  assert.equal(detectBrand("378282246310005"), "AMEX");
  assert.equal(detectBrand("6011111111111117"), "DISCOVER");
  assert.equal(detectBrand("9999"), "UNKNOWN");
  assert.equal(detectBrand(""), "UNKNOWN");
});

test("card numbers are grouped as typed, American Express as 4-6-5", () => {
  assert.equal(formatCardNumber("4242424242424242"), "4242 4242 4242 4242");
  assert.equal(formatCardNumber("42424"), "4242 4");
  assert.equal(formatCardNumber("378282246310005"), "3782 822463 10005");
  assert.equal(formatCardNumber("4242-4242 abcd 4242 4242 99999"), "4242 4242 4242 4242 999");
});

test("Luhn accepts the standard test numbers and rejects typos", () => {
  for (const ok of ["4242424242424242", "5555555555554444", "378282246310005", "6011111111111117", "4111 1111 1111 1111"]) assert.equal(isValidCardNumber(ok), true, ok);
  for (const bad of ["4242424242424241", "1234567890123456", "4242", "", "378282246310006", "37828224631000"]) assert.equal(isValidCardNumber(bad), false, bad);
});

test("expiry formatting, parsing and the end-of-month rule", () => {
  assert.equal(formatExpiry("1227"), "12 / 27");
  assert.equal(formatExpiry("5"), "05");
  assert.equal(formatExpiry("1"), "1");
  assert.equal(formatExpiry("12"), "12");
  assert.deepEqual(parseExpiry("12 / 27"), { month: 12, year: 2027 });
  assert.equal(parseExpiry("13 / 27"), null);
  assert.equal(parseExpiry("00 / 27"), null);
  assert.equal(parseExpiry("12 / 2"), null);
  const now = new Date(2026, 9, 6); // October 2026
  assert.equal(isExpired({ month: 10, year: 2026 }, now), false); // good through the end of October
  assert.equal(isExpired({ month: 9, year: 2026 }, now), true);
  assert.equal(isExpired({ month: 1, year: 2025 }, now), true);
  assert.equal(isExpired({ month: 1, year: 2030 }, now), false);
});

test("form validation reports each problem and passes a good card", () => {
  const now = new Date(2026, 9, 6);
  const good = { number: "4242 4242 4242 4242", expiry: "12 / 27", cvv: "123", name: "Daniel Lincoln", zip: "10001" };
  assert.deepEqual(validateCardForm(good, now), {});
  assert.deepEqual(Object.keys(validateCardForm({ number: "1", expiry: "13 / 99", cvv: "1", name: "", zip: "1" }, now)).sort(), ["cvv", "expiry", "name", "number", "zip"]);
  assert.equal(validateCardForm({ ...good, expiry: "01 / 20" }, now).expiry, "This card has expired.");
  assert.equal(cvvLength("AMEX"), 4);
  assert.deepEqual(validateCardForm({ ...good, number: "3782 822463 10005", cvv: "123" }, now), { cvv: "Enter the 4-digit security code." });
});

test("no card tokenizer is wired, so card details have nowhere to go", () => {
  // If this starts returning an object, the provider SDK has been integrated: review that it
  // sends card details directly to the provider and add tests for the success path.
  assert.equal(getCardTokenizer(), null);
});

import { usedShare } from "../clients/mobile/services/linqasend-limits.ts";

test("usedShare: fraction of a real limit, null when there is no limit", () => {
  assert.equal(usedShare("500000", "235000"), 0.47);
  assert.equal(usedShare("500000", "900000"), 1); // over the limit is capped at full
  assert.equal(usedShare("500000", "0"), 0);
  assert.equal(usedShare(null, "100"), null);
  assert.equal(usedShare(undefined, "100"), null);
  assert.equal(usedShare("0", "100"), null);
});

test("ZIP codes: 5 digits or ZIP+4, formatted as typed", () => {
  for (const ok of ["20740", "10001", "20740-1234", " 90210 "]) assert.equal(isValidZip(ok), true, ok);
  for (const bad of ["", "1234", "123456", "2074a", "20740-12", "20740 1234", "ABCDE"]) assert.equal(isValidZip(bad), false, bad);
  assert.equal(formatZip("20740"), "20740");
  assert.equal(formatZip("207401234"), "20740-1234");
  assert.equal(formatZip("20-74 0x12345678"), "20740-1234");
  assert.equal(validateCardForm({ number: "4242 4242 4242 4242", expiry: "12 / 27", cvv: "123", name: "Daniel Lincoln", zip: "2074" }, new Date(2026, 9, 6)).zip, "Enter the 5-digit ZIP code.");
});

test("the development tokenizer only talks to the loopback sandbox provider", async () => {
  const g = globalThis as { __DEV__?: boolean };
  g.__DEV__ = true;
  try {
    const t = getCardTokenizer();
    assert.notEqual(t, null);
    const card = { number: "4242424242424242", expMonth: 12, expYear: 2030, cvv: "123", holderName: "A B", billingPostalCode: "20740" };
    for (const endpoint of ["https://cards.example.com/cards/seti_abc", "http://10.0.0.5:8099/cards/seti_abc", "http://127.0.0.1:8099/other/seti_abc", undefined]) {
      await assert.rejects(t!.submit({ setupToken: "x".repeat(8), clientSecret: "s".repeat(8), ...(endpoint ? { cardEndpoint: endpoint } : {}) }, card), /card_provider_not_available/);
    }
    await assert.rejects(t!.submitCvv({ clientSecret: "s".repeat(8), cvvEndpoint: "https://evil.example/cvv/cvvs_ab" }, "123"), /card_provider_not_available/);
  } finally { delete g.__DEV__; }
});
