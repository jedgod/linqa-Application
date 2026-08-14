export type LinqaSendRecipient = {
  id: string;
  displayName: string;
  country: string;
  preferredCurrency: string;
  isFavorite: boolean;
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
  provider: string;
  expiresAt: string;
};

export type LinqaSendTransferSummary = {
  id: string;
  status: string;
  sendAmountMinor: string;
  sendCurrency: string;
  receiveAmountMinor: string;
  receiveCurrency: string;
  recipientName: string;
  createdAt: string;
  completedAt: string | null;
};

export type LinqaSendTransferDetail = LinqaSendTransferSummary & {
  failureCode: string | null;
  failureMessage: string | null;
  timeline: Array<{ phase: string; status: string; errorCode: string | null; at: string }>;
};

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
      throw new Error(message);
    }
    return payload as T;
  }

  listPaymentMethods() {
    return this.request<{ items: Array<{ id: string; type: string; last4: string | null; verificationStatus: string }> }>(
      "/v1/linqasend/payment-methods"
    );
  }

  addPaymentMethod(input: { type: "BANK_ACCOUNT" | "MOBILE_WALLET"; reference: string; last4?: string }) {
    return this.request<{ id: string }>("/v1/linqasend/payment-methods", { method: "POST", body: JSON.stringify(input) });
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

  findCorridor(input: { sourceCountry: string; destinationCountry: string; sourceCurrency: string; destinationCurrency: string }) {
    const params = new URLSearchParams(input).toString();
    return this.request<LinqaSendCorridor>(`/v1/linqasend/corridors?${params}`);
  }

  createQuote(input: {
    recipientId: string;
    sourceCountry: string;
    destinationCountry: string;
    sourceCurrency: string;
    destinationCurrency: string;
    paymentMethodId?: string;
    sendAmountMinor: string;
  }) {
    return this.request<LinqaSendQuote>("/v1/linqasend/quotes", { method: "POST", body: JSON.stringify(input) });
  }

  createTransfer(input: {
    quoteId: string;
    paymentMethodId: string;
    senderLegalName: string;
    senderCountry: string;
    purposeCode?: string;
  }) {
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    return this.request<{ transferId: string; status: string; reason?: string; action?: string; idempotentReplay: boolean }>(
      "/v1/linqasend/transfers",
      { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input) }
    );
  }

  listTransfers(limit = 30) {
    return this.request<{ items: LinqaSendTransferSummary[] }>(`/v1/linqasend/transfers?limit=${limit}`);
  }

  getTransfer(id: string) {
    return this.request<LinqaSendTransferDetail>(`/v1/linqasend/transfers/${id}`);
  }
}
