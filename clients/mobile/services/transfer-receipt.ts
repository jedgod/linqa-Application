import { displayMoney } from "./send-money-validation";
export interface ReceiptInput {
  id: string;
  direction?: "SENT" | "RECEIVED";
  sendAmountMinor: string;
  sendCurrency: string;
  receiveAmountMinor: string;
  receiveCurrency: string;
  recipientName: string;
  customerRate?: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ReceiptRow { label: string; value: string }

function money(minor: string, currency: string): string {
  const text = displayMoney(minor, currency);
  return currency === "USD" ? `${text.startsWith("-") ? "-$" + text.slice(1) : "$" + text}` : `${text} ${currency}`;
}

/** Date like "Oct 12, 2026, 3:42 PM" in the viewer's locale. Empty string when the date is unusable. */
export function receiptDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** Short reference shown to users, e.g. "LQ-1A2B3C4D5E". Derived from the public id so support can look it up. */
export function referenceId(id: string): string {
  return `LQ-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase()}`;
}

/** Rows for the receipt. The exchange rate is omitted when unknown (receiver view) or when no conversion happened. */
export function receiptRows(t: ReceiptInput): ReceiptRow[] {
  const rows: ReceiptRow[] = [
    { label: t.direction === "RECEIVED" ? "They Sent" : "You Sent", value: money(t.sendAmountMinor, t.sendCurrency) },
    { label: t.direction === "RECEIVED" ? "You Received" : "They Received", value: money(t.receiveAmountMinor, t.receiveCurrency) }
  ];
  const rate = t.customerRate ? Number(t.customerRate) : NaN;
  if (Number.isFinite(rate) && rate > 0 && t.sendCurrency !== t.receiveCurrency) {
    rows.push({ label: "Exchange Rate", value: `1 ${t.sendCurrency} = ${rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${t.receiveCurrency}` });
  }
  const when = receiptDate(t.completedAt ?? t.createdAt);
  if (when) rows.push({ label: "Date & Time", value: when });
  rows.push({ label: "Reference ID", value: referenceId(t.id) });
  return rows;
}

/** Plain text for the system share sheet. Contains no account or card details. */
export function receiptShareText(t: ReceiptInput): string {
  const party = t.direction === "RECEIVED" ? `From: ${t.recipientName}` : `To: ${t.recipientName}`;
  return ["LinqaSend receipt", "Transfer completed", party, ...receiptRows(t).map((r) => `${r.label}: ${r.value}`)].join("\n");
}
