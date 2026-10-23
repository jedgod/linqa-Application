import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { getCachedInstallationServerId } from "../account/InstallationRegistry";
import { createBiometricClient } from "./biometric-session";
import type { FeeSchedules } from "./wallet-fees";
import type { WalletInvoice } from "./wallet-stealthpay";
import { WalletApiError } from "./wallet-api-error";
import { demoNote, demoRequest } from "./wallet-demo";
import { walletDemoEnabled } from "./wallet-demo-mode";

export { WalletApiError };

/**
 * Client for the standalone Wallet API (`/v2/wallet/*`). It shares nothing with the LinqaSend transfer client:
 * the Wallet screens never import `linqasend.service`.
 *
 * Every value is server-owned: balances, quotes, fees, FX and status. Money is minor-unit strings, and a failed fetch
 * is surfaced as an error, never as an invented zero.
 */
export type WalletMoneyKind = "WITHDRAW" | "INTERNAL" | "TOPUP" | "EXTERNAL";
export type WalletBalance = {
  id: string; currency: string; jurisdiction: string; regulatoryEntityId: string; status: string; balanceVerified: boolean;
  postedMinor: string; pendingMinor: string; availableMinor: string; heldMinor: string; withdrawableMinor: string;
};
export type WalletMoneyQuote = {
  id: string; kind: WalletMoneyKind; walletId: string; amountMinor: string; feeMinor: string; totalMinor: string; currency: string;
  receiveAmountMinor: string; receiveCurrency: string; estimatedArrival: string; fxRate: string; expiresAt: string;
  /** The recipient record or bank account the money goes to (a Linqa recipient id, or a linked payment method id for cash out). */
  targetId: string;
};
export type WalletMoneyOperation = {
  id: string; kind: WalletMoneyKind; status: string; snapshot: WalletMoneyQuote; action_url: string | null;
  returned_minor: string; created_at: string; updated_at?: string; direction: "SENT" | "RECEIVED";
};
export type WalletReceipt = { id: string; amount_minor: string; currency: string; created_at: string; withdrawal_status: string | null; withdrawal_id: string | null };
export type WalletMoneyTarget = { id: string; name: string; type: string; currency: string; country: string };
export type WalletServices = {
  services: string[]; linkMethodSupported: boolean; displayCurrencySupported: boolean; cardsRoute: string;
  biometricAuthorizationRequired: boolean;
  permissions: string[]; securityOptions: Array<{ title: string; description: string; route: string }>;
  supportTopics: Array<{ title: string; body: string }>; supportRoute: string;
};
export type WalletFundingMethod = { id: string; type: string; last4: string | null; status: string };
export type WalletLimits = {
  period: 'ROLLING_24_HOURS'; includesFees: boolean; usageSources: string[];
  items: Array<{ walletId: string; currency: string; status: string; configured: boolean; perOperationMinor: string | null;
    dailyMinor: string | null; usedMinor: string; remainingMinor: string | null }>;
};
export type WalletReportOptions = { formats: string[]; reportType: string; timezone: string; periods: Array<{ period: string; count: number }> };

/** Where the wallet is, which currencies it can be opened in, and whether Linqa serves it there. Decided by the server. */
export type WalletUnavailableReason = "PROFILE_REQUIRED" | "ENTITY_NOT_ACTIVE" | "COUNTRY_NOT_SERVED" | "DEFAULT_CURRENCY_NOT_SERVED";
export type WalletProfile = {
  country: { code: string; name: string; accountCountry: string; residenceCountry: string; source: "VERIFIED_PROFILE" | "ACCOUNT_COUNTRY" } | null;
  defaultCurrency: string | null;
  currencies: Array<{ code: string; name: string; isDefault: boolean; available: boolean }>;
  serviceAvailable: boolean;
  unavailableReason: WalletUnavailableReason | null;
};

const PENDING_KEY = "linqasend.pendingWalletMoney";

function jwtUserId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Authenticated user identity is unavailable.");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const json = JSON.parse(atob(padded)) as { user_id?: string };
  if (!json.user_id) throw new Error("Authenticated user identity is unavailable.");
  return json.user_id;
}

export class WalletService {
  constructor(private readonly baseUrl: string, private readonly token: () => Promise<string>) {}

  /** Read-only price list for the amount-screen preview. The quote, not this, carries the fee that is charged. */
  fees() { return this.request<{ version: number; schedules: FeeSchedules }>("/v2/wallet/fees"); }
  profile() { return this.request<WalletProfile>("/v2/wallet/profile"); }
  services() { return this.request<WalletServices>("/v2/wallet/services"); }
  fundingMethods() { return this.request<{ items: WalletFundingMethod[] }>("/v2/wallet/funding-methods"); }
  async limits() {
    const data = await this.request<WalletLimits>("/v2/wallet/limits");
    if (data.period !== 'ROLLING_24_HOURS' || !Array.isArray(data.items)) throw new Error('Wallet limits are updating. Try again.');
    return data;
  }
  reportOptions() { return this.request<WalletReportOptions>("/v2/wallet/report-options"); }
  report(period: string) { return this.request<{ status: string; filename: string | null; mimeType?: string; content: string | null }>(`/v2/wallet/reports/${encodeURIComponent(period)}`); }
  /** Resolves a one-time invoice code. Only offered when the server lists the `stealthpay` service. */
  lookupInvoice(code: string) { return this.request<WalletInvoice>(`/v2/wallet/invoices/lookup?code=${encodeURIComponent(code)}`); }
  /** Creates a one-time invoice that pays into this wallet. The merchant receives `amountMinor`; the payer's fee is added at quote time. */
  createInvoice(input: { currency: string; amountMinor: string; ttlSeconds: number }) {
    // No idempotency key: the server keeps only a hash of the invoice code, so it can't replay a stored response. A retry makes a new invoice.
    return this.request<WalletInvoice>("/v2/wallet/invoices", { method: "POST", body: JSON.stringify(input) });
  }
  /** A server-priced quote for paying the invoice from the wallet; it is then authorized like any other wallet quote. */
  async invoiceQuote(invoiceId: string, idempotencyKey?: string) {
    if (await this.pending()) throw new Error("A wallet action needs a status check. Resume it before starting another.");
    return this.request<WalletMoneyQuote>(`/v2/wallet/invoices/${encodeURIComponent(invoiceId)}/quotes`, {
      method: "POST", body: "{}", ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {})
    });
  }
  balances() { return this.request<{ items: WalletBalance[] }>("/v2/wallet/balances"); }
  receipts() { return this.request<{ items: WalletReceipt[] }>("/v2/wallet/receipts"); }
  activity(walletId: string) {
    return this.request<{ items: Array<{ external_ref: string; kind: string; currency: string; created_at: string; bucket: string; amount_minor: string }> }>(`/v2/wallet/balances/${encodeURIComponent(walletId)}/activity`);
  }
  open(currency: string) { return this.request<{ id: string; currency: string }>("/v2/wallet/open", { method: "POST", body: JSON.stringify({ currency }) }); }
  cancelWithdrawal(id: string) { return this.request<{ status: string }>(`/v2/wallet/withdrawals/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }); }

  targets(kind: WalletMoneyKind) { return this.request<{ items: WalletMoneyTarget[] }>(`/v2/wallet/money/targets?kind=${kind}`); }
  /** Newest first, keyset-paged: pass the previous page's `nextCursor` to load older activity. */
  operations(page: { limit?: number; cursor?: string | null } = {}) {
    const query = new URLSearchParams();
    if (page.limit) query.set("limit", String(page.limit));
    if (page.cursor) query.set("cursor", page.cursor);
    const qs = query.toString();
    return this.request<{ items: WalletMoneyOperation[]; nextCursor: string | null }>(`/v2/wallet/money/operations${qs ? `?${qs}` : ""}`);
  }
  operation(id: string) { return this.request<WalletMoneyOperation>(`/v2/wallet/money/operations/${encodeURIComponent(id)}`); }
  cancelOperation(id: string) { return this.request<{ id: string; status: string }>(`/v2/wallet/money/operations/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }); }
  requestRefund(id: string) {
    return this.request<{ id: string; refundRequested: boolean }>(`/v2/wallet/money/operations/${encodeURIComponent(id)}/refund`, { method: "POST", body: JSON.stringify({ reasonCode: "OTHER" }) });
  }

  beginBankLink(type: "BANK_ACCOUNT" | "DEBIT_CARD" = "BANK_ACCOUNT") {
    return this.request<{ id: string; url: string; expiresAt: string }>("/v2/wallet/bank-links", { method: "POST", body: JSON.stringify({ type }) });
  }
  confirmBankLink(id: string) { return this.request<{ paymentMethodId: string }>(`/v2/wallet/bank-links/${encodeURIComponent(id)}/confirm`, { method: "POST", body: "{}" }); }

  /**
   * `idempotencyKey` identifies one review attempt: a retry after a timeout replays the same quote instead of creating a
   * second. The caller must use a new key whenever the inputs change or the quote is discarded or expires.
   */
  async quote(input: { walletId: string; kind: WalletMoneyKind; amountMinor: string; targetId: string }, idempotencyKey?: string) {
    if (await this.pending()) throw new Error("A wallet action needs a status check. Resume it before starting another.");
    return this.request<WalletMoneyQuote>("/v2/wallet/money/quotes", {
      method: "POST", body: JSON.stringify(input), ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {})
    });
  }

  async pending() {
    if (walletDemoEnabled()) return null; // demo mode never leaves a half-finished action behind
    const value = await new AccountSecureStorage().get(jwtUserId(await this.token()), PENDING_KEY);
    return value ? JSON.parse(value) as { quoteId: string; challengeId: string; biometricGrantId: string; installationId: string } : null;
  }

  /** Biometric step-up bound to the exact quote, then submit. The grant is stored first so a lost response can be resumed. */
  async authorize(quoteId: string) {
    if (walletDemoEnabled()) { // dev-only demo data: no biometric prompt, nothing leaves the device
      await this.request(`/v2/wallet/money/quotes/${encodeURIComponent(quoteId)}/challenge`, { method: "POST", body: "{}" });
      return this.request<{ id: string; status: string }>(`/v2/wallet/money/quotes/${encodeURIComponent(quoteId)}/submit`, { method: "POST", body: "{}" });
    }
    const installationId = await getCachedInstallationServerId();
    if (!installationId) throw new Error("Sign in again to authorize this wallet action.");
    const biometric = createBiometricClient(() => this.token());
    if (!(await biometric.available()).strong) throw new Error("Strong device biometrics are required.");
    const headers = { "x-installation-id": installationId };
    const c = await this.request<{ challengeId: string }>(`/v2/wallet/money/quotes/${encodeURIComponent(quoteId)}/challenge`, { method: "POST", headers, body: "{}" });
    const grant = await biometric.stepUp("SEND_WALLET_AUTHORIZE", { itemId: c.challengeId }, "Authorize this wallet action");
    const userId = jwtUserId(await this.token());
    await new AccountSecureStorage().put(userId, PENDING_KEY, JSON.stringify({ quoteId, challengeId: c.challengeId, biometricGrantId: grant.grantId, installationId }));
    return this.resume();
  }

  async resume() {
    const pending = await this.pending();
    if (!pending) throw new Error("No wallet action to resume.");
    const userId = jwtUserId(await this.token());
    const result = await this.request<{ id: string; status: string }>(`/v2/wallet/money/quotes/${encodeURIComponent(pending.quoteId)}/submit`, {
      method: "POST", headers: { "x-installation-id": pending.installationId },
      body: JSON.stringify({ challengeId: pending.challengeId, biometricGrantId: pending.biometricGrantId })
    });
    await new AccountSecureStorage().remove(userId, PENDING_KEY);
    return result;
  }

  async resolvePending() {
    const pending = await this.pending();
    if (!pending) throw new Error("No wallet action to check.");
    const userId = jwtUserId(await this.token());
    const result = await this.request<{ id: string; status: string }>(`/v2/wallet/money/quotes/${encodeURIComponent(pending.quoteId)}/resolve`, { method: "POST", body: "{}" });
    await new AccountSecureStorage().remove(userId, PENDING_KEY);
    return result;
  }

  /** A private note is kept on this device only (secure storage, per account); the server never sees it. */
  async saveNote(operationId: string, note: string) {
    const text = note.trim().slice(0, 140);
    if (walletDemoEnabled()) { if (text) demoNote.set(operationId, text); return; }
    if (text) await new AccountSecureStorage().put(jwtUserId(await this.token()), `wallet.note.${operationId}`, text);
  }
  async note(operationId: string) { if (walletDemoEnabled()) return demoNote.get(operationId); return new AccountSecureStorage().get(jwtUserId(await this.token()), `wallet.note.${operationId}`); }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (walletDemoEnabled()) return demoRequest<T>(path, init);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          authorization: `Bearer ${await this.token()}`,
          ...(init.headers ?? {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new WalletApiError(typeof payload.error === "string" ? payload.error : "Wallet request failed", payload as Record<string, unknown>, response.status);
      }
      return payload as T;
    } finally { clearTimeout(timeout); }
  }
}
