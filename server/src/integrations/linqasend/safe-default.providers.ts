import { UnconfiguredComplianceProvider } from "../../services/linqasend/compliance.service.js";
import { FailClosedPaymentProvider, type PaymentProvider } from "../../services/linqasend/payment-provider.js";
import type {
  ComplianceProvider,
  FundingAuthorizationResult,
  FundingProvider,
  FxRateProvider,
  KycProvider,
  LinqaSendProviders,
  PayoutProvider,
  PayoutResult
} from "./provider.contracts.js";

/**
 * No identity-verification (KYC) partner is configured in this
 * environment. Same convention as `UnconfiguredComplianceProvider`: report
 * REVIEW rather than either faking PASS or throwing, so the orchestrator
 * routes to manual review instead of silently skipping the check.
 */
export class SafeDefaultKycProvider implements KycProvider {
  readonly name = "unconfigured";
  async verifyIdentity(): Promise<{ decision: "REVIEW"; reasons: string[] }> {
    return { decision: "REVIEW", reasons: ["kyc_provider_not_configured"] };
  }
}

/**
 * Wraps the existing `FailClosedPaymentProvider` (the one real fail-closed
 * implementation of "no funding partner configured") behind the richer
 * `FundingProvider` contract, instead of re-implementing the same
 * fail-closed behavior a second time under a new name.
 */
export class SafeDefaultFundingProvider implements FundingProvider {
  private readonly delegate: PaymentProvider = new FailClosedPaymentProvider();
  readonly name = this.delegate.name;

  authorizeFunding(input: {
    transferId: string;
    providerPaymentMethodRef: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
  }): Promise<FundingAuthorizationResult> {
    return this.delegate.authorizeFunding(input);
  }

  async lookupByIdempotencyKey(): Promise<null> {
    // Nothing was ever authorized (every call above declines), so there is
    // nothing a reconciliation job could legitimately find here.
    return null;
  }
}

export class SafeDefaultPayoutProvider implements PayoutProvider {
  private readonly delegate: PaymentProvider = new FailClosedPaymentProvider();
  readonly name = this.delegate.name;

  async createPayout(input: {
    transferId: string;
    recipientProviderRef: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
  }): Promise<PayoutResult> {
    return this.delegate.createPayout(input);
  }

  async lookup(): Promise<null> {
    return null;
  }
}

export class SafeDefaultFxRateProvider implements FxRateProvider {
  private readonly delegate: PaymentProvider = new FailClosedPaymentProvider();
  fetchFxRate(input: { baseCurrency: string; quoteCurrency: string }) {
    return this.delegate.fetchFxRate(input);
  }
}

export function safeDefaultLinqaSendProviders(): LinqaSendProviders {
  return {
    kyc: new SafeDefaultKycProvider(),
    compliance: new UnconfiguredComplianceProvider() satisfies ComplianceProvider,
    funding: new SafeDefaultFundingProvider(),
    payout: new SafeDefaultPayoutProvider(),
    fx: new SafeDefaultFxRateProvider()
  };
}
