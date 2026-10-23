import assert from "node:assert/strict";
import { WalletApiError } from "./wallet-api-error";
import { DEMO_INVOICE_CODE, demoRequest, resetWalletDemo } from "./wallet-demo";
import type { WalletBalance, WalletMoneyOperation, WalletMoneyQuote } from "./wallet.service";

const get = <T,>(path: string) => demoRequest<T>(path);
const post = <T,>(path: string, body: unknown = {}) => demoRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
const balance = async () => (await get<{ items: WalletBalance[] }>("/v2/wallet/balances")).items[0]!;
const rejects = async (run: () => Promise<unknown>, code: string) => assert.rejects(run, (e: unknown) => (e as Error).message === code && typeof (e as WalletApiError).status === "number");

resetWalletDemo();

// The sample wallet is internally consistent: held and pending reflect queued operations.
const w = await balance();
assert.equal(w.currency, "USD");
assert.ok(BigInt(w.availableMinor) > 0n && BigInt(w.heldMinor) > 0n && BigInt(w.pendingMinor) > 0n);
assert.equal(w.withdrawableMinor, w.availableMinor);

// Activity covers every kind of row the screens style (all statuses, kinds, both directions), newest first, paged.
const all: WalletMoneyOperation[] = [];
let cursor: string | null = null;
do {
  const q = cursor ? `&cursor=${cursor}` : "";
  const page: { items: WalletMoneyOperation[]; nextCursor: string | null } = await get(`/v2/wallet/money/operations?limit=5${q}`);
  assert.ok(page.items.length <= 5);
  all.push(...page.items);
  cursor = page.nextCursor;
} while (cursor);
assert.equal(new Set(all.map((o) => o.id)).size, all.length, "no repeats across pages");
assert.deepEqual([...new Set(all.map((o) => o.status))].sort(), ["COMPLETED", "FAILED", "QUEUED", "RETURNED"]);
assert.deepEqual([...new Set(all.map((o) => o.kind))].sort(), ["EXTERNAL", "INTERNAL", "TOPUP", "WITHDRAW"]);
assert.ok(all.some((o) => o.direction === "RECEIVED"));
for (let i = 1; i < all.length; i++) assert.ok(Date.parse(all[i - 1]!.created_at) >= Date.parse(all[i]!.created_at), "newest first");
await rejects(() => get("/v2/wallet/money/operations?cursor=junk"), "WALLET_CURSOR_INVALID");

// A send: the fee schedule applies (10% of $25.00 = $2.50), and submitting twice does not debit twice.
const targets = (await get<{ items: { id: string; name: string }[] }>("/v2/wallet/money/targets?kind=INTERNAL")).items;
const before = BigInt((await balance()).availableMinor);
const quote = await post<WalletMoneyQuote>("/v2/wallet/money/quotes", { walletId: w.id, kind: "INTERNAL", amountMinor: "2500", targetId: targets[0]!.id });
assert.deepEqual([quote.feeMinor, quote.totalMinor, quote.receiveAmountMinor], ["250", "2750", "2500"]);
await post(`/v2/wallet/money/quotes/${quote.id}/challenge`);
const first = await post<{ id: string; status: string }>(`/v2/wallet/money/quotes/${quote.id}/submit`);
const again = await post<{ id: string; status: string }>(`/v2/wallet/money/quotes/${quote.id}/submit`);
assert.equal(first.status, "COMPLETED");
assert.deepEqual(again, first);
assert.equal(BigInt((await balance()).availableMinor), before - 2750n);
assert.equal((await get<WalletMoneyOperation>(`/v2/wallet/money/operations/${first.id}`)).direction, "SENT");

// Guardrails behave like the real API: no overspending, no unknown targets, limits enforced.
await rejects(() => post("/v2/wallet/money/quotes", { walletId: w.id, kind: "INTERNAL", amountMinor: "99999999", targetId: targets[0]!.id }), "WALLET_OPERATION_LIMIT_DENIED");
await rejects(() => post("/v2/wallet/money/quotes", { walletId: w.id, kind: "INTERNAL", amountMinor: "400000", targetId: targets[0]!.id }), "WALLET_INSUFFICIENT_FUNDS");
await rejects(() => post("/v2/wallet/money/quotes", { walletId: w.id, kind: "INTERNAL", amountMinor: "100", targetId: "00000000-0000-4000-8000-000000000999" }), "WALLET_RECIPIENT_NOT_FOUND");
await rejects(() => post("/v2/wallet/money/quotes", { walletId: w.id, kind: "INTERNAL", amountMinor: "0", targetId: targets[0]!.id }), "WALLET_REQUEST_DENIED");
await rejects(() => post("/v2/wallet/money/quotes/00000000-0000-4000-8000-000000000998/submit"), "WALLET_QUOTE_EXPIRED_OR_NOT_OWNED");

// A queued debit holds funds; cancelling releases exactly what it held, and a settled one cannot be cancelled.
const queued = all.find((o) => o.status === "QUEUED" && o.kind === "WITHDRAW")!;
const heldBefore = BigInt((await balance()).heldMinor);
const availBefore = BigInt((await balance()).availableMinor);
await post(`/v2/wallet/money/operations/${queued.id}/cancel`);
assert.equal(BigInt((await balance()).heldMinor), heldBefore - BigInt(queued.snapshot.totalMinor));
assert.equal(BigInt((await balance()).availableMinor), availBefore + BigInt(queued.snapshot.totalMinor));
await rejects(() => post(`/v2/wallet/money/operations/${queued.id}/cancel`), "WALLET_OPERATION_ALREADY_DISPATCHED");
const settled = all.find((o) => o.status === "COMPLETED" && o.kind === "INTERNAL")!;
await rejects(() => post(`/v2/wallet/money/operations/${settled.id}/cancel`), "WALLET_OPERATION_ALREADY_DISPATCHED");

// Supporting data the More pages read.
const limits = await get<{ items: { remainingMinor: string; usedMinor: string; dailyMinor: string }[] }>("/v2/wallet/limits");
assert.equal(BigInt(limits.items[0]!.usedMinor) + BigInt(limits.items[0]!.remainingMinor), BigInt(limits.items[0]!.dailyMinor));
const options = await get<{ periods: { period: string; count: number }[] }>("/v2/wallet/report-options");
assert.ok(options.periods.length >= 2);
const csv = await get<{ status: string; content: string | null }>(`/v2/wallet/reports/${options.periods[0]!.period}`);
assert.equal(csv.status, "READY");
assert.ok(csv.content!.startsWith("date,type,status,amount,currency,reference\n"));
assert.equal((await get<{ status: string }>("/v2/wallet/reports/1999-01")).status, "EMPTY");
assert.equal((await get<{ serviceAvailable: boolean }>("/v2/wallet/profile")).serviceAvailable, true);

// Opening another currency adds one wallet and is idempotent; an unserved currency is refused.
await post("/v2/wallet/open", { currency: "EUR" });
await post("/v2/wallet/open", { currency: "EUR" });
assert.equal((await get<{ items: unknown[] }>("/v2/wallet/balances")).items.length, 2);
await rejects(() => post("/v2/wallet/open", { currency: "JPY" }), "WALLET_CURRENCY_NOT_AVAILABLE");

// StealthPay invoice: lookup, server quote ($24.50 + 10% = $26.95), pay once, then the invoice is spent.
const services = await get<{ services: string[] }>("/v2/wallet/services");
assert.ok(services.services.includes("stealthpay"));
await rejects(() => get("/v2/wallet/invoices/lookup?code=inv_doesNotExist1"), "INVOICE_NOT_FOUND");
const invoice = await get<{ id: string; code: string; baseAmountMinor: string; merchantName: string }>(`/v2/wallet/invoices/lookup?code=${DEMO_INVOICE_CODE}`);
assert.equal(invoice.baseAmountMinor, "2450");
const iq = await post<WalletMoneyQuote>(`/v2/wallet/invoices/${invoice.id}/quotes`);
assert.deepEqual([iq.amountMinor, iq.feeMinor, iq.totalMinor], ["2450", "245", "2695"]);
const beforeInvoice = BigInt((await balance()).availableMinor);
await post(`/v2/wallet/money/quotes/${iq.id}/challenge`);
const paid = await post<{ id: string; status: string }>(`/v2/wallet/money/quotes/${iq.id}/submit`);
assert.equal(paid.status, "COMPLETED");
assert.equal(BigInt((await balance()).availableMinor), beforeInvoice - 2695n);
await rejects(() => get(`/v2/wallet/invoices/lookup?code=${DEMO_INVOICE_CODE}`), "INVOICE_ALREADY_PAID");
await rejects(() => post(`/v2/wallet/invoices/${invoice.id}/quotes`), "INVOICE_ALREADY_PAID");

// Switching demo on again starts from a clean slate.
resetWalletDemo();
assert.equal((await get<{ items: unknown[] }>("/v2/wallet/balances")).items.length, 1);
console.log("wallet-demo: ok");
