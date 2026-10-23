import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walletFailure, walletErrorText, isNetworkError, WALLET_FAILURE_CODES } from "./wallet-errors";

const f = (code: string) => walletFailure(new Error(code), "Unable to continue.");
assert.equal(f("WALLET_INSUFFICIENT_FUNDS").action, "LOAD");
assert.equal(f("WALLET_QUOTE_EXPIRED_OR_NOT_OWNED").action, "REVIEW");
assert.equal(f("IDEMPOTENCY_KEY_REUSED").action, "REVIEW");
assert.equal(f("IDEMPOTENCY_IN_PROGRESS").action, "ACTIVITY");
assert.equal(f("VERIFIED_OWNED_BANK_OR_CARD_REQUIRED").action, "LINK");
assert.equal(f("WALLET_DAILY_LIMIT_EXCEEDED").action, undefined);
// Field-level routing for forms
assert.equal(f("WALLET_INSUFFICIENT_FUNDS").field, "amount");
assert.equal(f("WALLET_DAILY_LIMIT_EXCEEDED").field, "amount");
assert.equal(f("RECIPIENT_WALLET_SAME_ENTITY_REQUIRED").field, "recipient");
assert.equal(f("WALLET_INTERNAL_RECIPIENT_INVALID").field, "recipient");
assert.equal(f("WALLET_QUOTE_EXPIRED_OR_NOT_OWNED").field, undefined);
// Network failures are told apart from server answers
assert.equal(isNetworkError(new TypeError("Network request failed")), true);
assert.equal(isNetworkError(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
assert.equal(isNetworkError(new Error("WALLET_INSUFFICIENT_FUNDS")), false);
// Codes are matched exactly: message text containing a keyword must not trigger a mapping.
assert.deepEqual(walletFailure(new Error("insufficient concurrent funds"), "Fallback."), { code: null, message: "insufficient concurrent funds" });
// Unmapped server code: generic text plus the code; non-code messages pass through; non-errors use the fallback.
assert.deepEqual(f("WALLET_SOMETHING_NEW"), { code: "WALLET_SOMETHING_NEW", message: "Unable to continue. (WALLET_SOMETHING_NEW)" });
assert.equal(walletFailure(new Error("Strong device biometrics are required."), "x").message, "Strong device biometrics are required.");
assert.equal(walletFailure("boom", "Unable to continue.").message, "Unable to continue.");
// No mapped message may promise that money was safe or unmoved.
for (const code of ["WALLET_INSUFFICIENT_FUNDS", "IDEMPOTENCY_IN_PROGRESS", "WALLET_OPERATION_ALREADY_DISPATCHED", "IDEMPOTENCY_UNAVAILABLE"]) {
  assert.doesNotMatch(walletErrorText(new Error(code), "x"), /\b(safe|not (been )?(charged|processed|debited))\b/i);
}
// Drift guard: a mapped code that the server no longer emits would silently stop helping anyone.
const serverSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/src");
const sources: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    if (name === "tests" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full); else if (name.endsWith(".ts")) sources.push(readFileSync(full, "utf8"));
  }
})(serverSrc);
const missing = WALLET_FAILURE_CODES.filter((code) => !sources.some((s) => s.includes(`'${code}'`) || s.includes(`"${code}"`)));
assert.deepEqual(missing, [], `mapped codes not found in server source: ${missing.join(", ")}`);
console.log("wallet-errors: ok");
