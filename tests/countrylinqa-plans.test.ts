import test from "node:test";
import assert from "node:assert/strict";
import { canChoose, failureMessage, formatPrice, methodAvailability, resultOf, safeReturn } from "../clients/mobile/services/countrylinqa-plans.ts";
import { chatAccessOutcome, chatStartError } from "../clients/mobile/services/countrylinqa-activation.ts";

test("prices read like the mockups", () => {
  assert.equal(formatPrice(499, "USD"), "$4.99");
  assert.equal(formatPrice(499, "USD", true), "$4.99 / month");
  assert.equal(formatPrice(999, "USD", true), "$9.99 / month");
  assert.equal(formatPrice(0, "USD"), "$0");
  assert.equal(formatPrice(0, "USD", true), "$0");
  assert.equal(formatPrice(1500, "USD"), "$15.00");
  assert.equal(formatPrice(305, "EUR"), "EUR 3.05");
});

test("only a step up from the current plan can be chosen", () => {
  assert.equal(canChoose("FREE", "PREMIUM"), true);
  assert.equal(canChoose("FREE", "ELITE"), true);
  assert.equal(canChoose("PREMIUM", "PREMIUM"), false);
  assert.equal(canChoose("PREMIUM", "ELITE"), true);
  assert.equal(canChoose("PREMIUM", "FREE"), false);
  assert.equal(canChoose("ELITE", "ELITE"), false);
});

test("card and PayPal use the provider page; Apple Pay and Google Pay are shown but off, with the reason", () => {
  const all = ["CARD", "APPLE_PAY", "GOOGLE_PAY", "PAYPAL"] as const;
  assert.deepEqual(methodAvailability("CARD", "android", [...all]), { available: true, reason: null });
  assert.deepEqual(methodAvailability("PAYPAL", "ios", [...all]), { available: true, reason: null });
  assert.deepEqual(methodAvailability("APPLE_PAY", "ios", [...all]), { available: false, reason: "Not available in this version" });
  assert.deepEqual(methodAvailability("APPLE_PAY", "android", [...all]), { available: false, reason: "Only on iPhone" });
  assert.deepEqual(methodAvailability("GOOGLE_PAY", "android", [...all]), { available: false, reason: "Not available in this version" });
  assert.deepEqual(methodAvailability("GOOGLE_PAY", "ios", [...all]), { available: false, reason: "Only on Android" });
  assert.deepEqual(methodAvailability("CARD", "android", []), { available: false, reason: "Not offered yet" });
});

test("the result screen only says success once billing confirmed it", () => {
  assert.equal(resultOf({ state: "SUCCEEDED" }), "SUCCESS");
  assert.equal(resultOf({ state: "CANCELED" }), "CANCELED");
  assert.equal(resultOf({ state: "FAILED" }), "FAILED");
  assert.equal(resultOf({ state: "CREATED" }), "PENDING");
});

test("failure text never suggests a charge happened", () => {
  assert.match(failureMessage("PAYMENT_NOT_CONFIGURED"), /not been charged/);
  assert.match(failureMessage("PAYMENT_START_FAILED"), /not been charged/);
  assert.match(failureMessage("METHOD_NOT_AVAILABLE"), /another/);
  assert.equal(failureMessage(null), "Please try again or use a different payment method.");
});

test("Continue returns to where the flow started, but only inside the app", () => {
  assert.equal(safeReturn("/countrylinqa/plan"), "/countrylinqa/plan");
  assert.equal(safeReturn("/settings/countrylinqa"), "/settings/countrylinqa");
  assert.equal(safeReturn("/countrylinqa/people?interest=music"), "/countrylinqa/people?interest=music");
  assert.equal(safeReturn(undefined), "/countrylinqa/plan");
  assert.equal(safeReturn("https://evil.example/x"), "/countrylinqa/plan");
  assert.equal(safeReturn("//evil.example"), "/countrylinqa/plan");
  assert.equal(safeReturn("/vault"), "/countrylinqa/plan");
  assert.equal(safeReturn("linqa://anything"), "/countrylinqa/plan");
  assert.equal(safeReturn("/countrylinqa/../vault"), "/countrylinqa/plan");
  assert.equal(safeReturn("/countrylinqa/x", "/home"), "/countrylinqa/x");
  assert.equal(safeReturn("nope", "/countrylinqa/world"), "/countrylinqa/world");
});

const GENERAL = "This person isn't accepting new chat requests from your current CountryLinqa reach.";

test("Chat unavailable reads the same whatever the other person's setting is", () => {
  for (const code of ["COUNTRY_NOT_ALLOWED", "CONTACTS_ONLY", "CHAT_REQUESTS_DISABLED"]) {
    assert.deepEqual(chatAccessOutcome(code), { kind: "UNAVAILABLE", title: "Chat unavailable", message: GENERAL });
  }
});

test("a block or a restriction does not read differently from any other refusal", () => {
  const generic = { kind: "UNAVAILABLE", title: "Chat unavailable", message: "You can't start this conversation." };
  for (const code of ["USER_NOT_FOUND", "BLOCKED", "RESTRICTED_USER", "INVALID_RECIPIENT", "SOMETHING_ELSE", undefined]) assert.deepEqual(chatAccessOutcome(code), generic);
});

test("your own unverified country and a bad connection are the only different answers", () => {
  assert.equal(chatAccessOutcome("COUNTRY_UNVERIFIED").kind, "VERIFY");
  assert.equal(chatAccessOutcome("NETWORK").kind, "RETRY");
  assert.equal(chatAccessOutcome("HTTP_500").kind, "RETRY");
  assert.equal(chatAccessOutcome("HTTP_503").kind, "RETRY");
  assert.equal(chatAccessOutcome("HTTP_403").kind, "UNAVAILABLE");
});

test("inline messages use the same words", () => {
  assert.equal(chatStartError("CONTACTS_ONLY"), GENERAL);
  assert.equal(chatStartError("BLOCKED"), "You can't start this conversation.");
});
