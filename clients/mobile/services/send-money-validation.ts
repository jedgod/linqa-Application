import type { LinqaSendQuote } from "./linqasend.service";

export function currencyDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid currency");
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function displayMoney(minor: string | number | bigint, currency: string): string {
  const digits = currencyDigits(currency);
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = (absolute / scale).toLocaleString("en-US");
  return `${value < 0n ? "-" : ""}${whole}${digits ? "." + (absolute % scale).toString().padStart(digits, "0") : ""}`;
}
export function parseMoney(text: string, currency: string): string | null {
  const digits = currencyDigits(currency);
  if (!(new RegExp(`^\\d{1,12}${digits ? `(\\.\\d{0,${digits}})?` : ""}$`)).test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  return amount > 0n ? amount.toString() : null;
}
export function parseReviewQuote(raw: unknown): LinqaSendQuote | null {
  try {
    if (typeof raw !== "string" || raw.length > 12_000) return null;
    const q = JSON.parse(raw);
    if (!q || typeof q !== "object") return null;
    for (const key of ["id", "recipientId", "corridorId"]) if (typeof q[key] !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(q[key])) return null;
    for (const key of ["sendAmountMinor", "receiveAmountMinor"]) if (typeof q[key] !== "string" || !/^\d{1,24}$/.test(q[key]) || BigInt(q[key]) <= 0n) return null;
    for (const key of ["senderFeeMinor", "recipientFeeMinor"]) if (q[key] !== undefined && (typeof q[key] !== "string" || !/^\d{1,24}$/.test(q[key]))) return null;
    for (const key of ["customerRate", "marketReferenceRate", "providerExecutionRate"]) if (typeof q[key] !== "string" || !/^\d+(\.\d+)?$/.test(q[key]) || !Number.isFinite(Number(q[key])) || Number(q[key]) <= 0) return null;
    currencyDigits(q.sendCurrency); currencyDigits(q.receiveCurrency);
    if (!Number.isFinite(Date.parse(q.expiresAt)) || typeof q.provider !== "string" || !Number.isFinite(q.marginBps) || q.marginBps < 0 || q.marginBps > 10000) return null;
    return q;
  } catch { return null; }
}
