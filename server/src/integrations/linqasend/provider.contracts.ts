/**
 * Richer LinqaSend provider contracts than `services/linqasend/payment-provider.ts`
 * originally shipped with: `FundingProvider`/`PayoutProvider` split apart
 * (each independently swappable, and each carrying a `lookup*` method a
 * reconciliation job needs — see `reconciliation.ts`) and a new
 * `KycProvider` the original pass didn't have. `ComplianceProvider` is
 * intentionally NOT redefined here — it is re-exported from
 * `services/linqasend/compliance.service.ts`, the one place that contract
 * already exists, so there is exactly one `ComplianceProvider` type in the
 * codebase rather than two structurally-identical ones under different
 * import paths.
 */
export type { ComplianceProvider, CompliancePerson } from "../../services/linqasend/compliance.service.js";

export interface KycPerson {
  legalName: string;
  dateOfBirth?: string | undefined;
  country: string;
  documentType?: string | undefined;
  documentReference?: string | undefined;
}

export interface KycProvider {
  readonly name: string;
  verifyIdentity(input: KycPerson): Promise<{ decision: "PASS" | "REVIEW" | "FAIL"; reasons: string[] }>;
}

export interface FundingAuthorizationResult {
  status: "AUTHORIZED" | "REQUIRES_ACTION" | "DECLINED";
  providerRef?: string | undefined;
  declineCode?: string | undefined;
}

/** Provider evidence for a refund; amounts are decimal minor-unit strings and must echo the original request scope. */
export interface FundingRefundResult {
  status: "REFUNDED" | "PENDING" | "FAILED";
  providerRef: string;
  fundingProviderRef: string;
  amountMinor: string;
  currency: string;
}

export interface FundingProvider {
  readonly name: string;
  authorizeFunding(input: {
    transferId: string;
    providerPaymentMethodRef: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
  }): Promise<FundingAuthorizationResult>;

  /** Reconciliation support: look up a prior authorization by the same
   * idempotency key this transfer would have used, without submitting a
   * new one. Used by `reconciliation.ts` to detect drift between our
   * ledger's belief about a transfer and the provider's. */
  lookupByIdempotencyKey(idempotencyKey: string): Promise<FundingAuthorizationResult | null>;
  /** Returns a sender's instant-delivery fee to the original funding instrument. Optional: absent means unsupported. */
  refundFee?(input: { transferId: string; fundingProviderRef: string; amountMinor: bigint; currency: string; idempotencyKey: string; reasonCode: "INSTANT_FEE_NOT_USED" }): Promise<FundingRefundResult>;
  /** Read-only recovery of a refund submitted under its original idempotency key. */
  lookupRefundByIdempotencyKey?(idempotencyKey: string): Promise<FundingRefundResult | null>;
}

export interface PayoutResult {
  status: "SUBMITTED" | "PROCESSING" | "COMPLETED" | "FAILED";
  providerRef: string;
  /** Explicit custody confirmation for an internal receipt; absent for external payouts. */
  walletCredit?: import("../../services/linqasend/wallet-ledger.service.js").WalletCreditEvidence | undefined;
}

export interface PayoutProvider {
  readonly name: string;
  createPayout(input: {
    transferId: string;
    recipientProviderRef: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
  }): Promise<PayoutResult>;

  /** Reconciliation support: look up a payout's current status by provider
   * reference, independent of whatever this process last recorded. */
  lookup(providerRef: string): Promise<PayoutResult | null>;
  /** Required to recover an accepted payout whose response/reference was lost. */
  lookupByIdempotencyKey?(key: string): Promise<PayoutResult | null>;
}

export interface FxRateProvider {
  fetchFxRate(input: { baseCurrency: string; quoteCurrency: string }): Promise<{
    marketRate: string;
    executionRate: string;
    validUntil: Date;
    sourceTimestamp: Date;
  }>;
}

export type CustodyAccountScope = {providerId:string;regulatoryEntityId:string;currency:string;accountReference:string};
export type CustodyBalance = CustodyAccountScope & {snapshotId:string;balanceMinor:string;asOf:string};
export type CustodyReceipt = {providerId:string;transferId:string;providerRef:string;status:"SETTLED";walletCredit:import("../../services/linqasend/wallet-ledger.service.js").WalletCreditEvidence};
export interface CustodyProvider {
  getBalance(scope:CustodyAccountScope):Promise<CustodyBalance>;
  lookupReceipt(payoutIdempotencyKey:string):Promise<CustodyReceipt|null>;
  capabilities():Promise<{version:"LINQASEND_WALLET_V1";custodyBalances:boolean;custodyReceiptLookup:boolean;payoutLookupByIdempotencyKey:boolean;senderFeeRefunds?:boolean|undefined}>;
}

export interface LinqaSendProviders {
  walletMoney?: import('./wallet-money.contracts.js').WalletMoneyGateway | undefined;
  custody?: CustodyProvider | undefined;
  kyc: KycProvider;
  compliance: import("../../services/linqasend/compliance.service.js").ComplianceProvider;
  funding: FundingProvider;
  payout: PayoutProvider;
  fx: FxRateProvider;
}
