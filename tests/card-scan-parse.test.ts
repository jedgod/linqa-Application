import test from "node:test";
import assert from "node:assert/strict";
import { cleanHolderName, describeScanOutcome, expiryDigits, interpretScan, isUnexpired, parseCardFromText } from "../clients/mobile/services/card-scan-parse.ts";

const NOW = new Date("2026-10-17T12:00:00Z");
const VISA = "4242424242424242";
const MC = "5555555555554444";
const AMEX = "378282246310005";

test("a good scan fills the number, expiry and name, and drops the CVV", () => {
  const out = interpretScan({ number: "4242 4242 4242 4242", expMonth: 3, expYear: 29, cvv: "812", holderName: "john  a doe", issuingNetwork: "Visa" }, NOW);
  assert.equal(out.status, "filled");
  if (out.status !== "filled") return;
  assert.deepEqual(out.card, { number: VISA, expMonth: 3, expYear: 2029, holderName: "JOHN A DOE" });
  assert.equal("cvv" in out.card, false);
  assert.equal(JSON.stringify(out).includes("812"), false);
  assert.equal(expiryDigits(out.card), "0329");
});

test("rejects numbers that fail the Luhn check, expired cards and empty scans", () => {
  assert.deepEqual(interpretScan({ number: "4242424242424241", expMonth: 3, expYear: 2029, holderName: null }, NOW), { status: "failed", reason: "INVALID_NUMBER" });
  assert.deepEqual(interpretScan({ number: VISA, expMonth: 9, expYear: 2026, holderName: null }, NOW), { status: "failed", reason: "EXPIRED" });
  assert.deepEqual(interpretScan({ number: "", expMonth: null, expYear: null, holderName: null }, NOW), { status: "failed", reason: "UNREADABLE" });
});

test("a card is valid through its expiry month and a missing expiry still prefills the number", () => {
  assert.equal(isUnexpired(10, 2026, NOW), true);
  assert.equal(isUnexpired(9, 2026, NOW), false);
  assert.equal(isUnexpired(1, 27, NOW), true);
  const out = interpretScan({ number: MC, expMonth: null, expYear: null, holderName: null }, NOW);
  assert.equal(out.status, "filled");
  if (out.status === "filled") assert.equal(expiryDigits(out.card), "");
});

test("holder names are cleaned and non-names are ignored", () => {
  assert.equal(cleanHolderName("  Maria-Elena  o'neil "), "MARIA-ELENA O'NEIL");
  assert.equal(cleanHolderName("VISA PLATINUM"), "");
  assert.equal(cleanHolderName("12345"), "");
  assert.equal(cleanHolderName(null), "");
  assert.equal(cleanHolderName("A".repeat(40)), "");
});

test("OCR text: finds the Luhn-valid number across spacing styles, the later date and a real name", () => {
  const lines = ["CHASE VISA", "4242 4242 4242 4242", "VALID FROM 01/24  VALID THRU 03/29", "JOHN Q PUBLIC", "Member since 2019"];
  assert.deepEqual(parseCardFromText(lines, NOW), { number: VISA, expMonth: 3, expYear: 2029, holderName: "JOHN Q PUBLIC" });
  assert.equal(parseCardFromText("5555-5555-5555-4444 exp 11/30", NOW).number, MC);
  assert.equal(parseCardFromText("3782 822463 10005", NOW).number, AMEX);
});

test("OCR text: ignores look-alike digit runs, expired dates and brand words", () => {
  const out = parseCardFromText(["Customer service 1 800 555 0199 ext 4242", "4242 4242 4242 4241", "EXP 05/21", "VISA CREDIT"], NOW);
  assert.equal(out.number, undefined);
  assert.equal(out.expMonth, undefined);
  assert.equal(out.holderName, undefined);
});

test("messages are plain, say nothing on cancel, and never contain card data", () => {
  assert.equal(describeScanOutcome({ status: "canceled" }), null);
  assert.match(describeScanOutcome({ status: "unavailable", reason: "NOT_IN_BUILD" })!, /latest version/);
  assert.match(describeScanOutcome({ status: "unavailable", reason: "LICENSE_MISSING" })!, /isn't set up/);
  assert.match(describeScanOutcome({ status: "failed", reason: "EXPIRED" })!, /expired/);
  assert.match(describeScanOutcome({ status: "filled", card: { number: VISA, expMonth: 3, expYear: 2029, holderName: "X Y" } })!, /type your security code yourself/);
  assert.equal(describeScanOutcome({ status: "filled", card: { number: VISA, expMonth: 3, expYear: 2029, holderName: "X Y" } })!.includes(VISA), false);
});

test("a refused license gets its own plain message", () => {
  assert.match(describeScanOutcome({ status: "failed", reason: "LICENSE_INVALID" })!, /isn't set up correctly/);
});
