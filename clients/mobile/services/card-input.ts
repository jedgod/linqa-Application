/**
 * Pure helpers for the Add New Card form: formatting and validation only.
 *
 * Nothing here stores, logs or sends card data. The form keeps the number, expiry and CVV in
 * component state for as long as the screen is open and hands them only to a payment provider's
 * tokenizer (see card-tokenizer.ts). Our own server never receives them.
 */
export type CardBrand = "VISA" | "MASTERCARD" | "AMEX" | "DISCOVER" | "UNKNOWN";

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function detectBrand(number: string): CardBrand {
  const n = digitsOnly(number);
  if (/^4/.test(n)) return "VISA";
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]|[3-6]|7[01]|720))/.test(n)) return "MASTERCARD";
  if (/^3[47]/.test(n)) return "AMEX";
  if (/^(6011|65|64[4-9])/.test(n)) return "DISCOVER";
  return "UNKNOWN";
}

export const BRAND_LABEL: Record<CardBrand, string> = { VISA: "Visa", MASTERCARD: "Mastercard", AMEX: "American Express", DISCOVER: "Discover", UNKNOWN: "Card" };

export function cvvLength(brand: CardBrand): number {
  return brand === "AMEX" ? 4 : 3;
}

/** "4242424242424242" -> "4242 4242 4242 4242" (American Express groups 4-6-5). */
export function formatCardNumber(input: string): string {
  const brand = detectBrand(input);
  const digits = digitsOnly(input).slice(0, brand === "AMEX" ? 15 : 19);
  const groups = brand === "AMEX" ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const out: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= digits.length) break;
    out.push(digits.slice(at, at + size));
    at += size;
  }
  return out.join(" ");
}

/** Luhn checksum, plus a plausible length. */
export function isValidCardNumber(input: string): boolean {
  const digits = digitsOnly(input);
  if (digits.length < 13 || digits.length > 19) return false;
  if (detectBrand(digits) === "AMEX" && digits.length !== 15) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Typing "1227" shows "12 / 27". A first digit of 2-9 becomes "0N" so "5" is not read as month 50. */
export function formatExpiry(input: string): string {
  let digits = digitsOnly(input).slice(0, 4);
  if (digits.length === 1 && Number(digits) > 1) digits = `0${digits}`;
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

export function parseExpiry(input: string): { month: number; year: number } | null {
  const digits = digitsOnly(input);
  if (digits.length !== 4) return null;
  const month = Number(digits.slice(0, 2));
  if (month < 1 || month > 12) return null;
  return { month, year: 2000 + Number(digits.slice(2)) };
}

/** A card is good through the END of its expiry month. */
export function isExpired(expiry: { month: number; year: number }, now = new Date()): boolean {
  return expiry.year < now.getFullYear() || (expiry.year === now.getFullYear() && expiry.month < now.getMonth() + 1);
}

export type CardFormErrors = Partial<Record<"number" | "expiry" | "cvv" | "name" | "address", string>>;

export function validateCardForm(form: { number: string; expiry: string; cvv: string; name: string; address: string }, now = new Date()): CardFormErrors {
  const errors: CardFormErrors = {};
  if (!isValidCardNumber(form.number)) errors.number = "Check the card number.";
  const expiry = parseExpiry(form.expiry);
  if (!expiry) errors.expiry = "Use MM / YY.";
  else if (isExpired(expiry, now)) errors.expiry = "This card has expired.";
  if (digitsOnly(form.cvv).length !== cvvLength(detectBrand(form.number))) errors.cvv = `Enter the ${cvvLength(detectBrand(form.number))}-digit security code.`;
  if (form.name.trim().length < 2) errors.name = "Enter the name on the card.";
  if (form.address.trim().length < 8) errors.address = "Enter the billing address.";
  return errors;
}
