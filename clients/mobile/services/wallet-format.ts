/**
 * Locale-aware money display for the Wallet screens. Amounts are always integer minor units in a string plus an ISO 4217
 * code; a symbol is only ever a label added for display. Nothing here parses a symbol back into an amount.
 */
import { currencyDigits } from "./send-money-validation";

export type CurrencyDisplay = { code: string; symbol: string; ambiguous: boolean };

/** Narrow symbols shared by several currencies ("$" is USD, CAD, AUD, ...). The code is shown beside these. */
const AMBIGUOUS_SYMBOLS = new Set(["$", "¥", "£", "kr", "Fr", "Fr.", "R", "₨", "K", "L", "Rs", "C$", "A$"]);

export function currencyDisplay(code: string, locale?: string): CurrencyDisplay {
  let symbol = code;
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency");
    if (part?.value) symbol = part.value;
  } catch { /* an engine without currency data falls back to the code */ }
  return { code, symbol, ambiguous: symbol === code || AMBIGUOUS_SYMBOLS.has(symbol) };
}

function separators(locale?: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    return { group: parts.find((p) => p.type === "group")?.value ?? ",", decimal: parts.find((p) => p.type === "decimal")?.value ?? "." };
  } catch { return { group: ",", decimal: "." }; }
}

/** The number part only, exact for any size: grouping and the decimal mark follow the locale, digits come from BigInt. */
export function formatMinor(minor: string, currency: string, locale?: string): string {
  const digits = currencyDigits(currency);
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = abs / scale;
  const { group, decimal } = separators(locale);
  let wholeText: string;
  try {
    wholeText = whole <= BigInt(Number.MAX_SAFE_INTEGER)
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(whole))
      : whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  } catch { wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  const fraction = digits ? `${decimal}${(abs % scale).toString().padStart(digits, "0")}` : "";
  return `${value < 0n ? "-" : ""}${wholeText}${fraction}`;
}

/**
 * "$25.00 USD" for a shared symbol, "GH₵25.00" style for a distinctive one, "25.00 XOF" when the platform has no symbol.
 * The ISO code travels with every amount whose symbol could be misread.
 */
export function formatMoney(minor: string, currency: string, locale?: string): string {
  const number = formatMinor(minor, currency, locale);
  const { symbol, ambiguous } = currencyDisplay(currency, locale);
  const negative = number.startsWith("-");
  const body = negative ? number.slice(1) : number;
  if (symbol === currency) return `${negative ? "-" : ""}${body} ${currency}`;
  return `${negative ? "-" : ""}${symbol}${body}${ambiguous ? ` ${currency}` : ""}`;
}

/** Symbol plus number with no ISO code, for layouts that show the code separately (e.g. under a row's amount). */
export function formatAmount(minor: string, currency: string, locale?: string): string {
  const number = formatMinor(minor, currency, locale);
  const { symbol } = currencyDisplay(currency, locale);
  if (symbol === currency) return number;
  return number.startsWith("-") ? `-${symbol}${number.slice(1)}` : `${symbol}${number}`;
}

/** Flag emoji from a two-letter country code, or an empty string for anything else. */
export function countryFlag(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
}
