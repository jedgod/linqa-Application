import test from "node:test";
import assert from "node:assert/strict";
import { displayMoney, parseMoney, parseReviewQuote } from "../clients/mobile/services/send-money-validation.ts";

test("currency formatting and parsing preserve minor units and large amounts", () => {
  assert.equal(displayMoney("1234", "JPY"), "1,234");
  assert.equal(displayMoney("1234", "KWD"), "1.234");
  assert.equal(displayMoney("900719925474099312", "USD"), "9,007,199,254,740,993.12");
  assert.equal(parseMoney("1.234", "KWD"), "1234");
  assert.equal(parseMoney("1.2", "JPY"), null);
  assert.equal(parseMoney("1.001", "USD"), null);
  assert.equal(parseMoney("0", "USD"), null);
});
test("review rejects missing, corrupt and incomplete navigation data", () => {
  for (const input of [undefined, [], "{", "null", "{}", JSON.stringify({ sendAmountMinor: "NaN" })]) assert.equal(parseReviewQuote(input), null);
});
