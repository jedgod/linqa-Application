/**
 * Pure presentation logic for the Wallet Activity page: classification, status wording, date grouping, period totals,
 * and filtering. No network or React here, so it can be tested directly.
 */
import type { WalletMoneyOperation } from "./wallet.service";

export type ActivityFilter = "ALL" | "RECEIVED" | "SENT" | "BANK";
export type StatusKey = "COMPLETED" | "PENDING" | "FAILED" | "REVERSED" | "CANCELED";
export type StatusFilter = "ANY" | StatusKey;
export type PeriodFilter = "ANY" | "MONTH" | "30D";

/** Money direction from this user's point of view. TOPUP is money in from a bank; WITHDRAW is money out to a bank. */
export function isIncoming(op: Pick<WalletMoneyOperation, "kind" | "direction">): boolean {
  return op.kind === "TOPUP" || (op.kind === "INTERNAL" && op.direction === "RECEIVED");
}
export const isBank = (op: Pick<WalletMoneyOperation, "kind">): boolean => op.kind === "TOPUP" || op.kind === "WITHDRAW";

export function matchesFilter(op: WalletMoneyOperation, filter: ActivityFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "BANK") return isBank(op);
  if (filter === "RECEIVED") return op.kind === "INTERNAL" && op.direction === "RECEIVED";
  return op.kind === "EXTERNAL" || (op.kind === "INTERNAL" && op.direction === "SENT"); // SENT
}

const STATUS_BY_SERVER: Record<string, StatusKey> = {
  COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELED: "CANCELED", RETURNED: "REVERSED", RETURN_REVIEW: "REVERSED"
};
/** Anything the server hasn't finished (queued, submitted, reconciling, ...) is Pending; nothing unknown is called Completed. */
export const statusKey = (serverStatus: string): StatusKey => STATUS_BY_SERVER[serverStatus] ?? "PENDING";
export const STATUS_LABEL: Record<StatusKey, string> = { COMPLETED: "Completed", PENDING: "Pending", FAILED: "Failed", REVERSED: "Reversed", CANCELED: "Canceled" };

export function describeOperation(op: WalletMoneyOperation, names: Map<string, string>): string {
  const name = names.get(op.snapshot.targetId);
  switch (op.kind) {
    case "TOPUP": return "Added money from LinqaSend";
    case "WITHDRAW": return name ? `Cash out to ${name}` : "Cash out to bank";
    case "INTERNAL": return op.direction === "RECEIVED" ? "Received from a Linqa user" : name ? `Sent to ${name}` : "Sent to a Linqa user";
    case "EXTERNAL": return name ? `Sent to ${name}` : "Sent outside Linqa";
  }
}

export type DateGroup = "Today" | "Yesterday" | "This week" | "Earlier";
const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dateGroup(iso: string, now: Date = new Date()): DateGroup {
  const day = startOfDay(new Date(iso)), today = startOfDay(now);
  if (day >= today) return "Today"; // includes clock skew into the future
  if (day >= today - DAY) return "Yesterday";
  if (day >= today - 6 * DAY) return "This week";
  return "Earlier";
}

export function groupByDate<T extends { created_at: string }>(items: T[], now: Date = new Date()): Array<{ title: DateGroup; items: T[] }> {
  const order: DateGroup[] = ["Today", "Yesterday", "This week", "Earlier"];
  const buckets = new Map<DateGroup, T[]>();
  for (const item of items) {
    const g = dateGroup(item.created_at, now);
    buckets.set(g, [...(buckets.get(g) ?? []), item]);
  }
  return order.filter((g) => buckets.has(g)).map((title) => ({ title, items: buckets.get(title)! }));
}

export function inPeriod(iso: string, period: PeriodFilter, now: Date = new Date()): boolean {
  if (period === "ANY") return true;
  const t = new Date(iso).getTime();
  if (period === "30D") return t >= now.getTime() - 30 * DAY;
  return new Date(iso).getFullYear() === now.getFullYear() && new Date(iso).getMonth() === now.getMonth();
}

export type ActivityQuery = { filter: ActivityFilter; status: StatusFilter; period: PeriodFilter; text: string };

export function applyQuery(items: WalletMoneyOperation[], q: ActivityQuery, names: Map<string, string>, now: Date = new Date()): WalletMoneyOperation[] {
  const needle = q.text.trim().toLowerCase();
  return items.filter((op) =>
    matchesFilter(op, q.filter)
    && (q.status === "ANY" || statusKey(op.status) === q.status)
    && inPeriod(op.created_at, q.period, now)
    && (!needle || op.id.toLowerCase().includes(needle) || describeOperation(op, names).toLowerCase().includes(needle)));
}

/** Money in/out for one currency over a period, from completed operations only. Fees on outgoing money count as money out. */
export function periodTotals(items: WalletMoneyOperation[], currency: string, period: PeriodFilter, now: Date = new Date()) {
  let inMinor = 0n, outMinor = 0n, count = 0;
  for (const op of items) {
    if (statusKey(op.status) !== "COMPLETED" || op.snapshot.currency !== currency || !inPeriod(op.created_at, period, now)) continue;
    count++;
    if (isIncoming(op)) inMinor += BigInt(op.kind === "TOPUP" ? op.snapshot.receiveAmountMinor : op.snapshot.amountMinor);
    else outMinor += BigInt(op.snapshot.totalMinor);
  }
  return { inMinor, outMinor, netMinor: inMinor - outMinor, count };
}

/** The currency to summarize: the one with the most completed activity, falling back to the first wallet's. */
export function summaryCurrency(items: WalletMoneyOperation[], fallback: string | null): string | null {
  const counts = new Map<string, number>();
  for (const op of items) if (statusKey(op.status) === "COMPLETED") counts.set(op.snapshot.currency, (counts.get(op.snapshot.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}
