export interface FxRateQuote {
  marketRate: string;
  executionRate: string;
  validUntil: Date;
  sourceTimestamp: Date;
}

export interface PaymentProvider {
  readonly name: string;

  authorizeFunding(input: {
    transferId: string;
    providerPaymentMethodRef: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ status: "AUTHORIZED" | "REQUIRES_ACTION" | "DECLINED"; providerRef?: string; declineCode?: string }>;

  createPayout(input: {
    transferId: string;
    recipientProviderRef: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ status: "SUBMITTED" | "PROCESSING" | "COMPLETED" | "FAILED"; providerRef: string }>;

  fetchFxRate(input: { baseCurrency: string; quoteCurrency: string }): Promise<FxRateQuote>;
}

/**
 * No licensed payment/remittance partner is configured in this environment
 * (see `README_UI_IMPLEMENTATION.md`'s note that real money movement
 * requires appropriately licensed, jurisdiction-approved rails). Every
 * money-moving call fails closed — same convention as
 * `FailClosedPushProvider` / `FailClosedVaultObjectStorage` — rather than
 * simulating an authorization or payout that never happened.
 */
export class FailClosedPaymentProvider implements PaymentProvider {
  readonly name = "unconfigured";

  async authorizeFunding(): Promise<{ status: "DECLINED"; declineCode: string }> {
    return { status: "DECLINED", declineCode: "payment_provider_not_configured" };
  }

  async createPayout(): Promise<never> {
    throw new Error("Payout provider is not configured.");
  }

  async fetchFxRate(): Promise<never> {
    throw new Error("Live FX rate provider is not configured; publish a rate to linqasend_fx_rate_snapshots instead.");
  }
}
