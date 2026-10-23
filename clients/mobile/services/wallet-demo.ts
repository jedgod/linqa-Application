/**
 * DEV-ONLY demo backend for the Wallet screens. It answers the same `/v2/wallet/*` requests as the real API from
 * in-memory sample data so every screen and flow can be seen without touching a database.
 *
 * It is reachable only through `wallet-demo-mode.ts`, which refuses to turn on outside a debug build. Everything here
 * is sample data: nothing is stored, sent or settled, and it resets whenever demo mode is switched on.
 */
import { WalletApiError } from "./wallet-api-error";
import { estimateFee, type FeeSchedules } from "./wallet-fees";
import type { WalletInvoice } from "./wallet-stealthpay";
import type {
  WalletBalance, WalletFundingMethod, WalletLimits, WalletMoneyKind, WalletMoneyOperation, WalletMoneyQuote, WalletMoneyTarget,
  WalletProfile, WalletReceipt, WalletReportOptions, WalletServices
} from "./wallet.service";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const SCHEDULES: FeeSchedules = { USD: { INTERNAL: { bps: 1000, minMinor: "45" }, EXTERNAL: { bps: 1599, minMinor: "65" } } };
const FX_GBP = { rate: "0.78", num: 78n, den: 100n };
const PER_OPERATION_MINOR = 500_000n, DAILY_MINOR = 1_000_000n;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WALLET_ID = id(101), BANK_ID = id(301), MERCHANT_ID = id(204), INVOICE_ID = id(701);
/** The one sample invoice demo mode can pay (a $24.50 charge from a demo merchant). */
export const DEMO_INVOICE_CODE = "inv_st1DemoK7n29x3p";
const TARGETS: Record<"INTERNAL" | "EXTERNAL", WalletMoneyTarget[]> = {
  INTERNAL: [
    { id: id(201), name: "Alex Chen", type: "LINQA_USER", currency: "USD", country: "US" },
    { id: id(202), name: "Maya Johnson", type: "LINQA_USER", currency: "USD", country: "US" },
    { id: MERCHANT_ID, name: "Demo Café", type: "LINQA_USER", currency: "USD", country: "US" }
  ],
  EXTERNAL: [{ id: id(203), name: "Sam Taylor (UK bank)", type: "BANK", currency: "GBP", country: "GB" }]
};
const NAMES = new Map<string, string>([...TARGETS.INTERNAL, ...TARGETS.EXTERNAL].map((t) => [t.id, t.name]));

type State = {
  wallets: WalletBalance[]; ops: WalletMoneyOperation[]; methods: WalletFundingMethod[]; receipts: WalletReceipt[];
  quotes: Map<string, WalletMoneyQuote>; notes: Map<string, string>; counter: number;
  invoiceQuotes: Map<string, string>; paidInvoices: Set<string>;
};
// Held on globalThis so a hot reload of this module does not silently re-seed the sample data mid-session.
const holder = ((globalThis as { __linqaWalletDemoState?: { state: State | null } }).__linqaWalletDemoState ??= { state: null });

function snapshot(kind: WalletMoneyKind, amount: bigint, fee: bigint, targetId: string, opts: { currency?: string; receive?: bigint; receiveCurrency?: string; rate?: string } = {}): WalletMoneyQuote {
  const currency = opts.currency ?? "USD";
  return {
    id: "", kind, walletId: WALLET_ID, amountMinor: amount.toString(), feeMinor: fee.toString(), totalMinor: (amount + fee).toString(), currency,
    receiveAmountMinor: (opts.receive ?? amount).toString(), receiveCurrency: opts.receiveCurrency ?? currency, estimatedArrival: "Demo", fxRate: opts.rate ?? "1",
    expiresAt: new Date(Date.now() + 90_000).toISOString(), targetId
  };
}

function seed(): State {
  const now = Date.now();
  let n = 500;
  const op = (kind: WalletMoneyKind, direction: "SENT" | "RECEIVED", status: string, agoMs: number, amount: number, fee: number, targetId: string,
    extra: { returned?: number; receive?: bigint; receiveCurrency?: string; rate?: string } = {}): WalletMoneyOperation => {
    const snap = snapshot(kind, BigInt(amount), BigInt(fee), targetId, extra);
    const opId = id(++n);
    return { id: opId, kind, status, snapshot: { ...snap, id: opId }, action_url: null, returned_minor: String(extra.returned ?? 0),
      created_at: new Date(now - agoMs).toISOString(), direction };
  };
  const ops = [
    op("INTERNAL", "RECEIVED", "COMPLETED", 90 * MINUTE, 5000, 0, id(202)),
    op("WITHDRAW", "SENT", "QUEUED", 3 * HOUR, 10000, 0, BANK_ID),
    op("EXTERNAL", "SENT", "QUEUED", 5 * HOUR, 5000, 800, id(203), { receive: (5000n * FX_GBP.num) / FX_GBP.den, receiveCurrency: "GBP", rate: FX_GBP.rate }),
    op("TOPUP", "SENT", "QUEUED", 6 * HOUR, 1500, 0, BANK_ID),
    op("INTERNAL", "SENT", "COMPLETED", 28 * HOUR, 2500, 250, id(201)),
    op("TOPUP", "SENT", "COMPLETED", 3 * DAY, 30000, 0, BANK_ID),
    op("WITHDRAW", "SENT", "COMPLETED", 4 * DAY, 20000, 0, BANK_ID),
    op("INTERNAL", "RECEIVED", "COMPLETED", 4 * DAY + HOUR, 12000, 0, id(201)),
    op("INTERNAL", "SENT", "COMPLETED", 5 * DAY, 4500, 450, id(201)),
    op("EXTERNAL", "SENT", "FAILED", 9 * DAY, 3000, 480, id(203), { receive: (3000n * FX_GBP.num) / FX_GBP.den, receiveCurrency: "GBP", rate: FX_GBP.rate }),
    op("WITHDRAW", "SENT", "RETURNED", 12 * DAY, 5000, 0, BANK_ID, { returned: 5000 }),
    op("TOPUP", "SENT", "COMPLETED", 15 * DAY, 50000, 0, BANK_ID),
    op("INTERNAL", "SENT", "COMPLETED", 40 * DAY, 7500, 750, id(202))
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // Held funds are the queued debits; pending is the queued bank load. Available is what is spendable right now.
  const held = ops.filter((o) => o.status === "QUEUED" && o.kind !== "TOPUP").reduce((sum, o) => sum + BigInt(o.snapshot.totalMinor), 0n);
  const pending = ops.filter((o) => o.status === "QUEUED" && o.kind === "TOPUP").reduce((sum, o) => sum + BigInt(o.snapshot.amountMinor), 0n);
  const available = 84250n;
  return {
    wallets: [{ id: WALLET_ID, currency: "USD", jurisdiction: "US", regulatoryEntityId: "demo-entity", status: "ACTIVE", balanceVerified: true,
      postedMinor: (available + held).toString(), pendingMinor: pending.toString(), availableMinor: available.toString(), heldMinor: held.toString(), withdrawableMinor: available.toString() }],
    ops, methods: [{ id: BANK_ID, type: "BANK_ACCOUNT", last4: "4821", status: "VERIFIED" }],
    receipts: [{ id: id(601), amount_minor: "7500", currency: "USD", created_at: new Date(now - 2 * DAY).toISOString(), withdrawal_status: "SCHEDULED", withdrawal_id: id(401) }],
    quotes: new Map(), notes: new Map(), counter: 900, invoiceQuotes: new Map(), paidInvoices: new Set()
  };
}

export function resetWalletDemo(): void { holder.state = seed(); }
const demo = (): State => (holder.state ??= seed());
const fail = (code: string, status = 409): never => { throw new WalletApiError(code, { error: code }, status); };
const wallet = (s: State) => s.wallets[0]!;

export const demoNote = {
  get: (opId: string): string | null => demo().notes.get(opId) ?? null,
  set: (opId: string, note: string): void => { demo().notes.set(opId, note); }
};

function release(s: State, o: WalletMoneyOperation, w: WalletBalance) {
  if (o.kind === "TOPUP") w.pendingMinor = (BigInt(w.pendingMinor) - BigInt(o.snapshot.amountMinor)).toString();
  else { w.heldMinor = (BigInt(w.heldMinor) - BigInt(o.snapshot.totalMinor)).toString(); w.availableMinor = (BigInt(w.availableMinor) + BigInt(o.snapshot.totalMinor)).toString(); }
  w.withdrawableMinor = w.availableMinor;
}

function targetsFor(s: State, kind: WalletMoneyKind): WalletMoneyTarget[] {
  if (kind === "INTERNAL" || kind === "EXTERNAL") return TARGETS[kind];
  return s.methods.map((m) => ({ id: m.id, name: `Account ending ${m.last4 ?? "----"}`, type: m.type, currency: "USD", country: "US" }));
}

function limits(s: State): WalletLimits {
  const w = wallet(s), since = Date.now() - DAY;
  const used = s.ops.filter((o) => o.direction === "SENT" && o.kind !== "TOPUP" && !["FAILED", "CANCELED", "RETURNED"].includes(o.status) && Date.parse(o.created_at) >= since)
    .reduce((sum, o) => sum + BigInt(o.snapshot.totalMinor), 0n);
  return { period: "ROLLING_24_HOURS", includesFees: true, usageSources: ["WALLET_OPERATIONS", "BANK_CASH_OUTS", "LINQASEND_TRANSFERS"],
    items: [{ walletId: w.id, currency: w.currency, status: w.status, configured: true, perOperationMinor: PER_OPERATION_MINOR.toString(), dailyMinor: DAILY_MINOR.toString(),
      usedMinor: used.toString(), remainingMinor: (DAILY_MINOR > used ? DAILY_MINOR - used : 0n).toString() }] };
}

const monthOf = (iso: string) => iso.slice(0, 7);
function reportOptions(s: State): WalletReportOptions {
  const counts = new Map<string, number>();
  for (const o of s.ops) counts.set(monthOf(o.created_at), (counts.get(monthOf(o.created_at)) ?? 0) + 1);
  return { formats: ["CSV"], reportType: "TRANSACTIONS", timezone: "UTC", periods: [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([period, count]) => ({ period, count })) };
}
function report(s: State, period: string) {
  const rows = s.ops.filter((o) => monthOf(o.created_at) === period);
  if (!rows.length) return { status: "EMPTY", filename: null, content: null };
  const lines = ["date,type,status,amount,currency,reference", ...rows.map((o) => `${o.created_at},${o.kind},${o.status},${o.snapshot.amountMinor},${o.snapshot.currency},${o.id}`)];
  return { status: "READY", filename: `wallet-transactions-${period}-DEMO.csv`, mimeType: "text/csv", content: `${lines.join("\n")}\n` };
}

const PROFILE: WalletProfile = {
  country: { code: "US", name: "United States", accountCountry: "US", residenceCountry: "US", source: "VERIFIED_PROFILE" },
  defaultCurrency: "USD",
  currencies: [{ code: "USD", name: "US Dollar", isDefault: true, available: true }, { code: "EUR", name: "Euro", isDefault: false, available: true }, { code: "GBP", name: "British Pound", isDefault: false, available: true }],
  serviceAvailable: true, unavailableReason: null
};
const SERVICES: WalletServices = {
  services: ["funding-methods", "currencies", "limits", "reports", "cards", "security", "support", "stealthpay"], linkMethodSupported: true, displayCurrencySupported: false,
  cardsRoute: "/linqasend/payment-methods", biometricAuthorizationRequired: true, permissions: ["linqasend:read", "linqasend:write"],
  securityOptions: [
    { title: "Privacy center", description: "Review privacy controls and device alerts.", route: "/privacy-center" },
    { title: "Privacy rights", description: "Review your data and privacy options.", route: "/settings/privacy-rights" }
  ],
  supportTopics: [
    { title: "Funding and withdrawals", body: "Link a bank account or debit card using secure provider setup. Wallet activity shows the status returned by the service. A pending payment is not settled money." },
    { title: "Transfers and limits", body: "Limits and eligible destinations depend on your verified account. Review the amount, fee and recipient before you confirm with biometrics." },
    { title: "Wallets and currencies", body: "Your wallet country comes from your verified profile. Opening a wallet does not move money." },
    { title: "Reports", body: "Monthly CSV activity reports are available once you have wallet transactions. They are not certified balance statements." }
  ],
  supportRoute: "/support"
};

type Body = Record<string, unknown>;

/** Answers one `/v2/wallet/*` request from the demo data, with the same shapes and error codes as the real API. */
export async function demoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const s = demo(), method = (init.method ?? "GET").toUpperCase();
  const [pathname = "", query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  let body: Body = {};
  try { body = init.body ? JSON.parse(String(init.body)) as Body : {}; } catch { body = {}; }
  const out = (value: unknown) => value as T;
  const m = (re: RegExp) => pathname.match(re);
  let r: RegExpMatchArray | null;

  if (method === "GET") {
    if (pathname === "/v2/wallet/fees") return out({ version: 1, schedules: SCHEDULES });
    if (pathname === "/v2/wallet/profile") return out(PROFILE);
    if (pathname === "/v2/wallet/services") return out(SERVICES);
    if (pathname === "/v2/wallet/funding-methods") return out({ items: s.methods });
    if (pathname === "/v2/wallet/invoices/lookup") {
      const code = params.get("code") ?? "";
      if (code !== DEMO_INVOICE_CODE) return fail("INVOICE_NOT_FOUND", 404);
      if (s.paidInvoices.has(INVOICE_ID)) return fail("INVOICE_ALREADY_PAID");
      const invoice: WalletInvoice = { id: INVOICE_ID, code, merchantName: "Demo Caf\u00e9", baseAmountMinor: "2450", currency: "USD", expiresAt: new Date(Date.now() + 15 * MINUTE).toISOString() };
      return out(invoice);
    }
    if (pathname === "/v2/wallet/limits") return out(limits(s));
    if (pathname === "/v2/wallet/report-options") return out(reportOptions(s));
    if ((r = m(/^\/v2\/wallet\/reports\/([^/]+)$/))) return out(report(s, decodeURIComponent(r[1]!)));
    if (pathname === "/v2/wallet/balances") return out({ items: s.wallets });
    if (pathname === "/v2/wallet/receipts") return out({ items: s.receipts });
    if (m(/^\/v2\/wallet\/balances\/[^/]+\/activity$/)) return out({ items: [] });
    if (pathname === "/v2/wallet/money/targets") return out({ items: targetsFor(s, (params.get("kind") ?? "WITHDRAW") as WalletMoneyKind) });
    if (pathname === "/v2/wallet/money/operations") {
      const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100);
      const cursor = params.get("cursor");
      const offset = cursor ? Number(/^demo:(\d+)$/.exec(cursor)?.[1] ?? NaN) : 0;
      if (!Number.isInteger(offset)) return fail("WALLET_CURSOR_INVALID", 422);
      const items = s.ops.slice(offset, offset + limit);
      return out({ items, nextCursor: offset + limit < s.ops.length ? `demo:${offset + limit}` : null });
    }
    if ((r = m(/^\/v2\/wallet\/money\/operations\/([^/]+)$/))) return out(s.ops.find((o) => o.id === decodeURIComponent(r![1]!)) ?? fail("WALLET_OPERATION_NOT_FOUND"));
  }

  if (method === "POST") {
    if (pathname === "/v2/wallet/open") {
      const currency = String(body.currency ?? "");
      if (!PROFILE.currencies.some((c) => c.code === currency && c.available)) return fail("WALLET_CURRENCY_NOT_AVAILABLE");
      const existing = s.wallets.find((w) => w.currency === currency);
      if (existing) return out({ id: existing.id, currency });
      const wid = id(110 + s.wallets.length);
      s.wallets.push({ id: wid, currency, jurisdiction: "US", regulatoryEntityId: "demo-entity", status: "ACTIVE", balanceVerified: true, postedMinor: "0", pendingMinor: "0", availableMinor: "0", heldMinor: "0", withdrawableMinor: "0" });
      return out({ id: wid, currency });
    }
    if ((r = m(/^\/v2\/wallet\/withdrawals\/([^/]+)\/cancel$/))) {
      const receipt = s.receipts.find((x) => x.withdrawal_id === decodeURIComponent(r![1]!));
      if (!receipt) return fail("WALLET_OPERATION_NOT_FOUND");
      s.receipts = s.receipts.filter((x) => x !== receipt);
      return out({ status: "CANCELED" });
    }
    if (pathname === "/v2/wallet/bank-links") return out({ id: "demo-link", url: "linqa://wallet/more", expiresAt: new Date(Date.now() + 10 * MINUTE).toISOString() });
    if (m(/^\/v2\/wallet\/bank-links\/[^/]+\/confirm$/)) {
      const mid = id(310 + s.methods.length);
      s.methods.push({ id: mid, type: "BANK_ACCOUNT", last4: "7712", status: "VERIFIED" });
      return out({ paymentMethodId: mid });
    }
    if (pathname === "/v2/wallet/invoices") {
      // Demo requests are shown but only the sample invoice can be paid, so a created code is not resolvable here.
      const currency = String(body.currency ?? ""), amountMinor = String(body.amountMinor ?? ""), ttl = Number(body.ttlSeconds ?? 900);
      if (!currency || !/^[1-9]\d*$/.test(amountMinor)) return fail("INVALID_AMOUNT", 400);
      const code = `inv_st1${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
      const invoice: WalletInvoice = { id: id(800 + s.counter++), code, merchantName: "You", baseAmountMinor: amountMinor, currency, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
      return out(invoice);
    }
    if ((r = m(/^\/v2\/wallet\/invoices\/([^/]+)\/quotes$/))) {
      if (decodeURIComponent(r[1]!) !== INVOICE_ID) return fail("INVOICE_NOT_FOUND", 404);
      if (s.paidInvoices.has(INVOICE_ID)) return fail("INVOICE_ALREADY_PAID");
      const w = wallet(s), base = 2450n;
      const fee = estimateFee(SCHEDULES, "INTERNAL", w.currency, base.toString())?.feeMinor ?? fail("WALLET_FEE_SCHEDULE_MISSING");
      if (base + fee > BigInt(w.availableMinor)) return fail("WALLET_INSUFFICIENT_FUNDS");
      const q = snapshot("INTERNAL", base, fee, MERCHANT_ID, { currency: w.currency });
      q.id = id(++s.counter); q.walletId = w.id; q.estimatedArrival = "On successful authorization";
      s.quotes.set(q.id, q); s.invoiceQuotes.set(q.id, INVOICE_ID);
      return out(q);
    }
    if (pathname === "/v2/wallet/money/quotes") {
      const kind = body.kind as WalletMoneyKind, w = s.wallets.find((x) => x.id === body.walletId) ?? fail("WALLET_NOT_ACTIVE");
      const amountText = String(body.amountMinor ?? "");
      if (!/^[1-9]\d*$/.test(amountText)) return fail("WALLET_REQUEST_DENIED");
      const amount = BigInt(amountText), targetId = String(body.targetId ?? "");
      const target = targetsFor(s, kind).find((t) => t.id === targetId) ?? fail(kind === "INTERNAL" || kind === "EXTERNAL" ? "WALLET_RECIPIENT_NOT_FOUND" : "VERIFIED_OWNED_BANK_OR_CARD_REQUIRED");
      const fee = kind === "INTERNAL" || kind === "EXTERNAL" ? (estimateFee(SCHEDULES, kind, w.currency, amountText)?.feeMinor ?? fail("WALLET_FEE_SCHEDULE_MISSING")) : 0n;
      if (amount + fee > PER_OPERATION_MINOR) return fail("WALLET_OPERATION_LIMIT_DENIED");
      if (kind !== "TOPUP" && amount + fee > BigInt(w.availableMinor)) return fail("WALLET_INSUFFICIENT_FUNDS");
      const fx = kind === "EXTERNAL" && target.currency === "GBP";
      const q = snapshot(kind, amount, fee, targetId, { currency: w.currency, ...(fx ? { receive: (amount * FX_GBP.num) / FX_GBP.den, receiveCurrency: "GBP", rate: FX_GBP.rate } : {}) });
      q.id = id(++s.counter); q.walletId = w.id;
      q.estimatedArrival = kind === "INTERNAL" ? "On successful authorization" : kind === "WITHDRAW" ? "1–3 business days (demo)" : kind === "TOPUP" ? "After the provider confirms settlement (demo)" : "Within 1 business day (demo)";
      s.quotes.set(q.id, q);
      return out(q);
    }
    if ((r = m(/^\/v2\/wallet\/money\/quotes\/([^/]+)\/(challenge|submit|resolve)$/))) {
      const quoteId = decodeURIComponent(r[1]!), step = r[2]!;
      const q = s.quotes.get(quoteId);
      if (step === "challenge") { if (!q) return fail("WALLET_QUOTE_EXPIRED_OR_NOT_OWNED"); return out({ challengeId: id(++s.counter), expiresAt: new Date(Date.now() + MINUTE).toISOString() }); }
      if (step === "resolve") return out({ id: quoteId, status: "CANCELED" });
      // submit is idempotent: a repeat returns the operation that already exists
      const existing = s.ops.find((o) => o.id === quoteId);
      if (existing) return out({ id: existing.id, status: existing.status });
      if (!q || Date.parse(q.expiresAt) <= Date.now()) return fail("WALLET_QUOTE_EXPIRED_OR_NOT_OWNED");
      const w = s.wallets.find((x) => x.id === q.walletId)!;
      const total = BigInt(q.totalMinor);
      if (q.kind !== "TOPUP" && total > BigInt(w.availableMinor)) return fail("WALLET_INSUFFICIENT_FUNDS");
      const status = q.kind === "INTERNAL" ? "COMPLETED" : "QUEUED";
      if (q.kind === "TOPUP") w.pendingMinor = (BigInt(w.pendingMinor) + BigInt(q.amountMinor)).toString();
      else {
        w.availableMinor = (BigInt(w.availableMinor) - total).toString();
        if (status === "QUEUED") w.heldMinor = (BigInt(w.heldMinor) + total).toString();
      }
      w.withdrawableMinor = w.availableMinor;
      s.ops.unshift({ id: q.id, kind: q.kind, status, snapshot: q, action_url: null, returned_minor: "0", created_at: new Date().toISOString(), direction: "SENT" });
      const paidInvoice = s.invoiceQuotes.get(q.id);
      if (paidInvoice) s.paidInvoices.add(paidInvoice);
      return out({ id: q.id, status });
    }
    if ((r = m(/^\/v2\/wallet\/money\/operations\/([^/]+)\/cancel$/))) {
      const o = s.ops.find((x) => x.id === decodeURIComponent(r![1]!)) ?? fail("WALLET_OPERATION_NOT_FOUND");
      if (o.status !== "QUEUED") return fail("WALLET_OPERATION_ALREADY_DISPATCHED");
      release(s, o, wallet(s)); o.status = "CANCELED";
      return out({ id: o.id, status: o.status });
    }
    if ((r = m(/^\/v2\/wallet\/money\/operations\/([^/]+)\/refund$/))) {
      const o = s.ops.find((x) => x.id === decodeURIComponent(r![1]!)) ?? fail("WALLET_OPERATION_NOT_FOUND");
      if (o.status !== "COMPLETED" || (o.kind !== "WITHDRAW" && o.kind !== "EXTERNAL")) return fail("WALLET_REFUND_NOT_ELIGIBLE");
      return out({ id: o.id, refundRequested: true });
    }
  }
  return fail("WALLET_REQUEST_DENIED", 404);
}
