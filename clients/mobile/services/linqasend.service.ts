import { ed25519 } from "@noble/curves/ed25519.js";
import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { getCachedInstallationServerId } from "../account/InstallationRegistry";
import { base64ToBytes, bytesToBase64 } from "../crypto/device-enrollment-proof";
import { createBiometricClient } from "./biometric-session";

export type LinqaSendRecipient = {
  id: string;
  displayName: string;
  country: string;
  preferredCurrency: string;
  isFavorite: boolean;
  /** LINQA_USER, or the external payout kind (BANK_ACCOUNT, MOBILE_WALLET, CARD, ...). */
  recipientType?: string;
  createdAt: string;
};

export type LinqaSendCorridor = {
  id: string;
  minAmountMinor: string;
  maxAmountMinor: string;
  provider: string;
  estimatedDeliveryText: string | null;
};

export type LinqaSendQuote = {
  id: string;
  recipientId: string;
  corridorId: string;
  sendAmountMinor: string;
  sendCurrency: string;
  receiveAmountMinor: string;
  receiveCurrency: string;
  marketReferenceRate: string;
  providerExecutionRate: string;
  customerRate: string;
  marginBps: number;
  senderFeeMinor?: string;
  recipientFeeMinor?: string;
  provider: string;
  expiresAt: string;
};

export type LinqaSendPaymentMethod = {
  id: string;
  type: string;
  last4: string | null;
  verificationStatus: string;
  isDefault?: boolean;
  /** Reported by the payment provider; null until a provider supplies them. */
  brand?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
};

export type LinqaSendLimits = {
  jurisdiction: string;
  countryCapability: Record<string, unknown> | null;
  corridors: Array<Record<string, unknown>>;
  rolling24Hours: { usedMinor: string; transferCount: number };
  currency?: string;
  /** Null limits mean "no fixed limit on this account", not unknown. */
  perTransferLimitMinor?: string | null;
  daily?: { limitMinor: string | null; usedMinor: string; remainingMinor: string | null };
  monthly?: { limitMinor: string | null; usedMinor: string; remainingMinor: string | null };
};

export type LinqaSendTransferSummary = {
  id: string;
  status: string;
  sendAmountMinor: string;
  sendCurrency: string;
  receiveAmountMinor: string;
  receiveCurrency: string;
  /** The other person: who you sent to, or who sent to you. */
  recipientName: string;
  direction?: "SENT" | "RECEIVED";
  createdAt: string;
  completedAt: string | null;
};

export type LinqaSendTransferDetail = LinqaSendTransferSummary & {
  recipientCountry?: string | null;
  recipientType?: string | null;
  customerRate?: string | null;
  senderFeeMinor?: string | null;
  recipientFeeMinor?: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  timeline: Array<{ phase: string; status: string; errorCode: string | null; at: string }>;
};

export type LinqaSendSecurityWarning = { code: string; severity: "INFO" | "WARN" | "HIGH" | "CRITICAL"; messageKey: string };
export class LinqaSendApiError extends Error {
  constructor(message: string, readonly payload: Record<string, unknown>, readonly status: number) { super(message); }
}
export type PreparedLinqaSendTransfer = {
  input: { quoteId: string; paymentMethodId: string; purposeCode?: string };
  idempotencyKey: string;
  installationId: string;
  transactionHash: string;
  securityAuthorizationId: string;
};

function jwtUserId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Authenticated user identity is unavailable.");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const json = JSON.parse(atob(padded)) as { user_id?: string };
  if (!json.user_id) throw new Error("Authenticated user identity is unavailable.");
  return json.user_id;
}

/**
 * Real client for `server/src/routes/linqasend/routes.ts`. Every value here
 * is genuine — FX pricing, transfer state, idempotent retry — the only
 * thing that fails closed is funding authorization, because no licensed
 * payment/remittance provider is configured (see `services/linqasend/
 * payment-provider.ts` on the server): transfers land in MANUAL_REVIEW or
 * DECLINED rather than pretending money moved.
 */
export class LinqaSendService {
  constructor(private readonly baseUrl: string, private readonly token: () => Promise<string>) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${await this.token()}`,
        ...(init.headers ?? {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : "LinqaSend request failed";
      throw new LinqaSendApiError(message, payload as Record<string, unknown>, response.status);
    }
    return payload as T;
  }

  listPaymentMethods() {
    return this.request<{ items: LinqaSendPaymentMethod[] }>("/v1/linqasend/payment-methods");
  }

  addPaymentMethod(input: { type: "BANK_ACCOUNT" | "MOBILE_WALLET"; reference: string; last4?: string }) {
    return this.request<{ id: string }>("/v1/linqasend/payment-methods", { method: "POST", body: JSON.stringify(input) });
  }

  setupPaymentMethod(input: { type: "DEBIT_CARD" | "CREDIT_CARD" | "BANK_ACCOUNT" | "MOBILE_WALLET"; billingCountry?: string }) {
    return this.request<{ setupToken: string; clientSecret: string; expiresAt: string }>("/v1/linqasend/payment-methods/setup", { method: "POST", body: JSON.stringify(input) });
  }

  confirmPaymentMethod(setupToken: string) {
    return this.request<{ id: string; type: string; last4: string | null; verificationStatus: string }>("/v1/linqasend/payment-methods/confirm", { method: "POST", body: JSON.stringify({ setupToken }) });
  }

  listRecipients() {
    return this.request<{ items: LinqaSendRecipient[] }>("/v1/linqasend/recipients");
  }

  addRecipient(query: string) {
    return this.request<{ id: string; displayName: string }>("/v1/linqasend/recipients", {
      method: "POST",
      body: JSON.stringify({ query })
    });
  }

  getJurisdiction() {
    return this.request<{ userId: string; verifiedResidenceCountry: string; accountCountry: string; currentPhysicalCountry: string | null; regulatoryJurisdiction: string; locationRelationship: string; migrationStatus: string; jurisdictionVersion: number }>("/v1/linqasend/jurisdiction");
  }

  listRelocations() {
    return this.request<{ items: Array<{ id: string; from_country: string; requested_country: string; status: string; reason: string | null; requested_at: string }> }>("/v1/linqasend/jurisdiction/relocations");
  }

  requestRelocation(targetCountry: string, reason?: string) {
    return this.request<{ id: string; status: string }>("/v1/linqasend/jurisdiction/relocations", { method: "POST", body: JSON.stringify({ targetCountry, ...(reason ? { reason } : {}) }) });
  }

  findCorridor(input: { sourceCountry: string; destinationCountry: string; sourceCurrency: string; destinationCurrency: string }) {
    const params = new URLSearchParams(input).toString();
    return this.request<LinqaSendCorridor>(`/v1/linqasend/corridors?${params}`);
  }

  createQuote(input: {
    recipientId: string;
    sourceCountry?: string;
    destinationCountry?: string;
    sourceCurrency: string;
    destinationCurrency: string;
    paymentMethodId?: string;
    sendAmountMinor: string;
  }) {
    return this.request<LinqaSendQuote>("/v1/linqasend/quotes", { method: "POST", body: JSON.stringify(input) });
  }

  async prepareTransferConfirmation(input: PreparedLinqaSendTransfer["input"]): Promise<PreparedLinqaSendTransfer> {
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const installationId = await getCachedInstallationServerId();
    if (!installationId) throw new Error("This installation is not registered for secure payments. Sign in again.");
    const token = await this.token();
    const userId = jwtUserId(token);
    const challenge = await this.request<{ id: string; nonce: string; transactionHash: string }>("/v1/linqasend/security/challenges", {
      method: "POST", headers: { "x-installation-id": installationId }, body: JSON.stringify({ quoteId: input.quoteId, paymentMethodId: input.paymentMethodId, idempotencyKey })
    });
    const biometric = createBiometricClient(async () => token);
    if ((await biometric.available()).strong) {
      const grant = await biometric.stepUp("SEND_TRANSFER_AUTHORIZE",{ paymentChallengeId: challenge.id },"Authorize this LinqaSend transfer");
      const authorization = await this.request<{ authorizationId: string; transactionHash: string }>("/v1/linqasend/security/authorizations",{ method: "POST",headers: { "x-installation-id": installationId },body: JSON.stringify({ challengeId: challenge.id,biometricGrantId: grant.grantId }) });
      return { input,idempotencyKey,installationId,transactionHash: authorization.transactionHash,securityAuthorizationId: authorization.authorizationId };
    }
    if (!__DEV__) throw new Error("Strong biometric signing is required for LinqaSend. Rebuild the app and enroll device biometrics.");
    const privateKey = await new AccountSecureStorage().get(userId, "device.signingPrivateKey");
    if (!privateKey) throw new Error("This device has no secure signing key. Re-enroll the device.");
    const message = new TextEncoder().encode(`${challenge.nonce}|${challenge.transactionHash}`);
    const signatureBase64 = bytesToBase64(ed25519.sign(message, base64ToBytes(privateKey)));
    const authorization = await this.request<{ authorizationId: string; transactionHash: string }>("/v1/linqasend/security/authorizations", {
      method: "POST", body: JSON.stringify({ challengeId: challenge.id, signatureBase64 })
    });
    return { input, idempotencyKey, installationId, transactionHash: authorization.transactionHash, securityAuthorizationId: authorization.authorizationId };
  }

  submitPreparedTransfer(prepared: PreparedLinqaSendTransfer, acknowledgedWarningCodes: string[] = []) {
    return this.request<{ transferId: string; status: string; reason?: string; action?: string; idempotentReplay: boolean }>(
      "/v1/linqasend/transfers",
      { method: "POST", headers: { "idempotency-key": prepared.idempotencyKey, "x-installation-id": prepared.installationId }, body: JSON.stringify({ ...prepared.input, transactionHash: prepared.transactionHash, securityAuthorizationId: prepared.securityAuthorizationId, acknowledgedWarningCodes }) }
    );
  }

  async createTransfer(input: PreparedLinqaSendTransfer["input"]) {
    return this.submitPreparedTransfer(await this.prepareTransferConfirmation(input));
  }

  listTransfers(limit = 30, options: { offset?: number; direction?: "all" | "sent" | "received" } = {}) {
    const query = `limit=${limit}${options.offset ? `&offset=${options.offset}` : ""}${options.direction && options.direction !== "all" ? `&direction=${options.direction}` : ""}`;
    return this.request<{ items: LinqaSendTransferSummary[]; nextOffset?: number | null }>(`/v1/linqasend/transfers?${query}`);
  }

  getDashboard() {
    return this.request<{ currency: string; totalSentMinor: string; thisMonthMinor: string; thisWeekMinor: string; transferCount: number }>("/v1/linqasend/dashboard");
  }

  getTransfer(id: string) {
    return this.request<LinqaSendTransferDetail>(`/v1/linqasend/transfers/${id}`);
  }

  getHome() {
    return this.request<{ jurisdiction: string; recipientCount: number; verifiedFundingSourceCount: number; requests: { incoming: number; outgoing: number } }>("/v1/linqasend/home");
  }

  getReceiveProfile() {
    return this.request<{ displayName: string | null; identifiers: Array<{ type: string; display_value: string }>; defaultCurrency: string | null; preferredFundingSource: { type: string; last4: string | null } | null }>("/v1/linqasend/receive-profile");
  }

  payoutProviders() {
    return this.request<{ items: Array<{ providerId: string }> }>("/v1/linqasend/payout-providers");
  }

  addExternalRecipient(input: { recipientKind: "EXTERNAL_PERSON" | "EXTERNAL_BUSINESS"; displayName: string; countryCode: string; currency: string; deliveryMethod: "BANK" | "CARD" | "MOBILE_MONEY" | "PHONE_CLAIM" | "EMAIL_CLAIM"; provider: string; providerToken: string; maskedDisplay: string; phone?: string; favorite?: boolean }) {
    return this.request<{ id: string; recipientId: string; endpointId: string }>("/v1/linqasend/external-recipients", { method: "POST", body: JSON.stringify(input) });
  }

  listMoneyRequests() {
    return this.request<{ items: Array<{ id: string; direction: "INCOMING" | "OUTGOING"; counterpartyName: string | null; amountMinor: string; currency: string; note: string | null; status: string; recipientId: string; expiresAt: string; createdAt: string }> }>("/v1/linqasend/requests");
  }

  createMoneyRequest(input: { payer: string; amountMinor: string; currency: string; note?: string }) {
    return this.request<{ id: string; status: string }>("/v1/linqasend/requests", { method: "POST", body: JSON.stringify(input) });
  }

  payMoneyRequest(id: string) {
    return this.request<{ requestId: string; recipientId: string; amountMinor: string; currency: string; purposeCode: string }>(`/v1/linqasend/requests/${id}/pay`, { method: "POST" });
  }

  declineMoneyRequest(id: string) {
    return this.request<void>(`/v1/linqasend/requests/${id}/decline`, { method: "POST" });
  }

  getLimits() {
    return this.request<LinqaSendLimits>("/v1/linqasend/limits");
  }

  getSettings() {
    return this.request<{ default_currency: string | null; default_payment_method_id: string | null; transfer_notifications: boolean; request_notifications: boolean; scam_warning_level: "STANDARD" | "ENHANCED" }>("/v1/linqasend/settings");
  }

  updateSettings(input: { defaultCurrency?: string; defaultPaymentMethodId?: string; transferNotifications?: boolean; requestNotifications?: boolean; scamWarningLevel?: "STANDARD" | "ENHANCED" }) {
    return this.request<{ updated: boolean }>("/v1/linqasend/settings", { method: "PATCH", body: JSON.stringify(input) });
  }

  deletePaymentMethod(id: string) {
    return this.request<void>(`/v1/linqasend/payment-methods/${id}`, { method: "DELETE" });
  }

  cancelTransfer(id: string) {
    return this.request<{ id: string; status: string }>(`/v1/linqasend/transfers/${id}/cancel`, { method: "POST" });
  }

  requestRefund(id: string, reasonCode: string, notes?: string) {
    return this.request<{ actionId: string; adjustmentId: string; status: string }>(`/v1/linqasend/transfers/${id}/refund`, { method: "POST", body: JSON.stringify({ reasonCode, ...(notes ? { notes } : {}) }) });
  }
}
