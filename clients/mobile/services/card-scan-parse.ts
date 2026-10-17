/**
 * Pure helpers for auto-scanning a card into the Add New Card form. No React Native imports, so they run under Node tests.
 *
 * Privacy rules (same as card-input.ts): nothing here stores, logs or sends card data. A scan result lives in memory only
 * long enough to prefill the form. The security code (CVV) is never prefilled: the sender types it themselves.
 */
import { detectBrand, digitsOnly, isValidCardNumber } from "./card-input";

/** What a native scanner returns. `cvv` may be present on some cards but is deliberately ignored. */
export type RawScannedCard = {
  number: string;
  expMonth: number | null;
  expYear: number | null;
  cvv?: string | null;
  holderName: string | null;
  issuingNetwork?: string | null;
};

/** What we prefill. There is no cvv field on purpose. */
export type CardScanFill = { number: string; expMonth: number | null; expYear: number | null; holderName: string };

export type CardScanFailure = "UNREADABLE" | "INVALID_NUMBER" | "EXPIRED" | "LICENSE_INVALID" | "SCANNER_ERROR";
export type CardScanOutcome =
  | { status: "filled"; card: CardScanFill }
  | { status: "canceled" }
  | { status: "unavailable"; reason: "NOT_IN_BUILD" | "LICENSE_MISSING" }
  | { status: "failed"; reason: CardScanFailure };

const NOISE_WORDS = new Set([
  "VISA", "MASTERCARD", "AMEX", "AMERICAN", "EXPRESS", "DISCOVER", "DEBIT", "CREDIT", "BANK", "CARD", "VALID", "THRU", "FROM", "GOOD",
  "MEMBER", "SINCE", "CARDHOLDER", "PLATINUM", "GOLD", "SIGNATURE", "REWARDS", "WORLD", "BUSINESS", "PREPAID", "CLASSIC", "ELECTRON", "UNION", "PAY"
]);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Four-digit year from a two- or four-digit year. */
export function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/** True when the card is still valid in the given month (cards stay valid through the last day of the expiry month). */
export function isUnexpired(expMonth: number, expYear: number, now = new Date()): boolean {
  const year = fullYear(expYear);
  return year > now.getFullYear() || (year === now.getFullYear() && expMonth >= now.getMonth() + 1);
}

/** "john  a  DOE " -> "JOHN A DOE". Returns "" for anything that does not look like a person's name. */
export function cleanHolderName(raw: string | null | undefined): string {
  if (!raw) return "";
  const name = raw.replace(/[^A-Za-z'.\- ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (name.length < 2 || name.length > 26) return "";
  const words = name.split(" ");
  return words.every((w) => NOISE_WORDS.has(w)) ? "" : name;
}

/** Turns a native scan into something the form can safely prefill, or says why not. The CVV is dropped here. */
export function interpretScan(card: RawScannedCard, now = new Date()): CardScanOutcome {
  const number = digitsOnly(card.number ?? "");
  if (!number) return { status: "failed", reason: "UNREADABLE" };
  if (!isValidCardNumber(number)) return { status: "failed", reason: "INVALID_NUMBER" };
  const month = card.expMonth, year = card.expYear;
  const hasExpiry = month !== null && year !== null && month >= 1 && month <= 12 && year > 0;
  if (hasExpiry && !isUnexpired(month, year, now)) return { status: "failed", reason: "EXPIRED" };
  return {
    status: "filled",
    card: { number, expMonth: hasExpiry ? month : null, expYear: hasExpiry ? fullYear(year) : null, holderName: cleanHolderName(card.holderName) }
  };
}

/** A short, plain message for the person, or null when nothing needs saying (a prefill or a cancel). */
export function describeScanOutcome(outcome: CardScanOutcome): string | null {
  switch (outcome.status) {
    case "filled": return "Card read. Check the details, then type your security code yourself.";
    case "canceled": return null;
    case "unavailable": return outcome.reason === "NOT_IN_BUILD"
      ? "Card scanning needs the latest version of the app. You can still type your card in."
      : "Card scanning isn't set up yet. You can still type your card in.";
    case "failed":
      return outcome.reason === "EXPIRED" ? "That card looks expired. Try another card or type it in."
        : outcome.reason === "INVALID_NUMBER" ? "We couldn't read the card number clearly. Try again with better light, or type it in."
        : outcome.reason === "UNREADABLE" ? "We couldn't read that card. Try again or type it in."
        : outcome.reason === "LICENSE_INVALID" ? "Card scanning isn't set up correctly yet. You can still type your card in."
        : "The scanner couldn't start. You can still type your card in.";
  }
}

/** Digits for the form's expiry field ("MMYY"), or "" when the scan had no expiry. */
export function expiryDigits(card: Pick<CardScanFill, "expMonth" | "expYear">): string {
  return card.expMonth !== null && card.expYear !== null ? `${pad2(card.expMonth)}${pad2(card.expYear % 100)}` : "";
}

/**
 * Reads card details out of OCR text (for example ML Kit lines from a photo). More careful than a bare regex:
 * the number must pass the Luhn check, the later of two dates wins (VALID FROM / VALID THRU), and the name must
 * look like a name. Pass one string per recognized line when you have them; a single blob also works.
 */
export function parseCardFromText(input: string | string[], now = new Date()): Partial<CardScanFill> {
  const lines = (Array.isArray(input) ? input : input.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const blob = lines.join("\n");

  let number: string | undefined;
  for (const match of blob.matchAll(/(?:\d[ \-]?){12,18}\d/g)) {
    const digits = digitsOnly(match[0]);
    if (isValidCardNumber(digits) && detectBrand(digits) !== "UNKNOWN") { number = digits; break; }
  }
  if (!number) for (const match of blob.matchAll(/(?:\d[ \-]?){12,18}\d/g)) { const d = digitsOnly(match[0]); if (isValidCardNumber(d)) { number = d; break; } }

  let best: { month: number; year: number } | undefined;
  for (const m of blob.matchAll(/(?<!\d)(0[1-9]|1[0-2])\s*[\/\-]\s*(\d{4}|\d{2})(?!\d)/g)) {
    const month = Number(m[1]), year = fullYear(Number(m[2]));
    if (year < 2000 || year > 2099) continue;
    if (!best || year > best.year || (year === best.year && month > best.month)) best = { month, year };
  }
  if (best && !isUnexpired(best.month, best.year, now)) best = undefined;

  let holderName = "";
  for (const line of lines) {
    if (/\d/.test(line)) continue;
    const name = cleanHolderName(line);
    if (name.split(" ").length >= 2 && !name.split(" ").some((w) => NOISE_WORDS.has(w))) { holderName = name; break; }
  }

  return {
    ...(number ? { number } : {}),
    ...(best ? { expMonth: best.month, expYear: best.year } : {}),
    ...(holderName ? { holderName } : {})
  };
}
