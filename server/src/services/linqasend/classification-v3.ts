export enum TransferClass {
  INTERNAL_DOMESTIC = "INTERNAL_DOMESTIC",
  INTERNAL_CROSS_BORDER = "INTERNAL_CROSS_BORDER",
  EXTERNAL_DOMESTIC = "EXTERNAL_DOMESTIC",
  EXTERNAL_CROSS_BORDER = "EXTERNAL_CROSS_BORDER"
}

export enum CapabilityStatus {
  ENABLED = "ENABLED",
  CONDITIONAL = "CONDITIONAL",
  RECEIVE_ONLY = "RECEIVE_ONLY",
  BANK_OUTBOUND_ONLY = "BANK_OUTBOUND_ONLY",
  RESTRICTED = "RESTRICTED",
  TEMPORARILY_SUSPENDED = "TEMPORARILY_SUSPENDED",
  UNSUPPORTED = "UNSUPPORTED"
}

export enum FundingMode {
  LINQA_BALANCE = "LINQA_BALANCE",
  BANK = "BANK",
  DEBIT_CARD = "DEBIT_CARD",
  CREDIT_CARD = "CREDIT_CARD",
  MOBILE_MONEY = "MOBILE_MONEY"
}

export enum ReceiveMode {
  LINQA_BALANCE = "LINQA_BALANCE",
  BANK = "BANK",
  CARD = "CARD",
  MOBILE_MONEY = "MOBILE_MONEY"
}

export enum RailType {
  INTERNAL_LEDGER = "INTERNAL_LEDGER",
  DOMESTIC_FUNDING = "DOMESTIC_FUNDING",
  LOCAL_BANK = "LOCAL_BANK",
  MOBILE_MONEY = "MOBILE_MONEY",
  CARD_PUSH = "CARD_PUSH",
  RTP = "RTP",
  IMTO = "IMTO",
  CORRESPONDENT_BANK = "CORRESPONDENT_BANK",
  CROSS_BORDER_INTERNAL_SETTLEMENT = "CROSS_BORDER_INTERNAL_SETTLEMENT"
}

export enum RecipientType {
  LINQA_USER = "LINQA_USER",
  BANK_RECIPIENT = "BANK_RECIPIENT",
  MOBILE_MONEY_RECIPIENT = "MOBILE_MONEY_RECIPIENT",
  CARD_RECIPIENT = "CARD_RECIPIENT"
}

export interface SenderContext {
  userId: string;
  customerLedgerAccountId?: string;
  verifiedCountry: string;
  baseCurrency: string;
  kycLevel: number;
  kycStatus: string;
  riskScore: number;
  deviceTrust: "TRUSTED" | "UNKNOWN" | "RISKY";
  accountStatus: "ACTIVE" | "RESTRICTED" | "SUSPENDED";
}

export interface ResolvedRecipient {
  recipientType: RecipientType;
  recipientId: string;
  userId?: string;
  customerLedgerAccountId?: string;
  verifiedCountry: string;
  receiveCurrency: string;
  receiveMode: ReceiveMode;
  verified: boolean;
}

export interface TransferClassification {
  transferClass: TransferClass;
  sameCountry: boolean;
  sameCurrency: boolean;
  internalRecipient: boolean;
}

export interface Money {
  amountMinor: bigint;
  currency: string;
}

export interface CountryCapabilityVersion {
  id: string;
  country: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  domesticInternalStatus: CapabilityStatus;
  domesticBankInStatus: CapabilityStatus;
  domesticBankOutStatus: CapabilityStatus;
  domesticMerchantStatus: CapabilityStatus;
  domesticRequestMoneyStatus: CapabilityStatus;
  crossBorderInboundStatus: CapabilityStatus;
  crossBorderOutboundStatus: CapabilityStatus;
  crossBorderBankOutboundStatus: CapabilityStatus;
  allowedFundingModes: FundingMode[];
  allowedReceiveModes: ReceiveMode[];
  sourceReference?: string;
  approvedBy?: string;
  approvedAt?: Date;
}

export interface CorridorRuleVersion {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  transferClass: TransferClass;
  version: number;
  status: CapabilityStatus;
  effectiveFrom: Date;
  effectiveTo?: Date;
  sourceCurrencies: string[];
  destinationCurrencies: string[];
  permittedFundingModes: FundingMode[];
  permittedReceiveModes: ReceiveMode[];
  permittedRails: RailType[];
  minAmountMinor?: bigint;
  maxAmountMinor?: bigint;
  minKycLevel?: number;
  requiresPurposeCode?: boolean;
  requiresSourceOfFunds?: boolean;
  requiresManualReview?: boolean;
  providerId?: string;
}

export interface CapabilityDecision {
  allowed: boolean;
  status: CapabilityStatus;
  reasonCode?: string;
  transferClass: TransferClass;
  requiresFx: boolean;
  requiresBankRail: boolean;
  permittedRails: RailType[];
  permittedFundingModes: FundingMode[];
  permittedReceiveModes: ReceiveMode[];
  countryPolicyId?: string;
  countryPolicyVersion?: number;
  corridorRuleId?: string;
  corridorRuleVersion?: number;
}

export interface CapabilitySnapshot extends CapabilityDecision {
  evaluatedAt: string;
  sourceCountry: string;
  destinationCountry: string;
  sourceCurrency: string;
  destinationCurrency: string;
  fundingMode: FundingMode;
  receiveMode: ReceiveMode;
}

export interface CapabilityRepository {
  getActiveCountryVersion(country: string, at: Date): Promise<CountryCapabilityVersion | null>;
  getActiveCorridorVersion(
    sourceCountry: string,
    destinationCountry: string,
    transferClass: TransferClass,
    at: Date
  ): Promise<CorridorRuleVersion | null>;
}

export class TransferClassifier {
  classify(sender: SenderContext, recipient: ResolvedRecipient): TransferClassification {
    const sameCountry = sender.verifiedCountry.toUpperCase() === recipient.verifiedCountry.toUpperCase();
    const sameCurrency = sender.baseCurrency.toUpperCase() === recipient.receiveCurrency.toUpperCase();
    const internalRecipient = recipient.recipientType === RecipientType.LINQA_USER;
    const transferClass = internalRecipient
      ? sameCountry
        ? TransferClass.INTERNAL_DOMESTIC
        : TransferClass.INTERNAL_CROSS_BORDER
      : sameCountry
        ? TransferClass.EXTERNAL_DOMESTIC
        : TransferClass.EXTERNAL_CROSS_BORDER;
    return { transferClass, sameCountry, sameCurrency, internalRecipient };
  }
}

export class RegulatoryCapabilityEngine {
  constructor(private readonly repo: CapabilityRepository) {}

  async decide(args: {
    sender: SenderContext;
    recipient: ResolvedRecipient;
    classification: TransferClassification;
    amount: Money;
    fundingMode: FundingMode;
    receiveMode: ReceiveMode;
    purposeCode?: string;
    at?: Date;
  }): Promise<CapabilityDecision> {
    const at = args.at ?? new Date();
    const source = args.sender.verifiedCountry.toUpperCase();
    const destination = args.recipient.verifiedCountry.toUpperCase();
    if (args.sender.accountStatus !== "ACTIVE") return this.block(args.classification, "SENDER_ACCOUNT_NOT_ACTIVE");
    if (!args.recipient.verified) return this.block(args.classification, "RECIPIENT_NOT_VERIFIED");

    if (args.classification.transferClass === TransferClass.INTERNAL_DOMESTIC) {
      const country = await this.repo.getActiveCountryVersion(source, at);
      if (!country) return this.block(args.classification, "COUNTRY_CAPABILITY_NOT_CONFIGURED");
      if (![CapabilityStatus.ENABLED, CapabilityStatus.CONDITIONAL].includes(country.domesticInternalStatus)) {
        return this.block(args.classification, "DOMESTIC_INTERNAL_NOT_AVAILABLE", country.domesticInternalStatus, country);
      }
      if (!country.allowedFundingModes.includes(args.fundingMode)) {
        return this.block(args.classification, "DOMESTIC_FUNDING_MODE_NOT_ALLOWED", country.domesticInternalStatus, country);
      }
      if (!country.allowedReceiveModes.includes(args.receiveMode)) {
        return this.block(args.classification, "DOMESTIC_RECEIVE_MODE_NOT_ALLOWED", country.domesticInternalStatus, country);
      }
      if (!args.classification.sameCurrency) {
        const rule = await this.repo.getActiveCorridorVersion(source, destination, TransferClass.INTERNAL_DOMESTIC, at);
        if (!rule) return this.block(args.classification, "DOMESTIC_INTERNAL_FX_NOT_CONFIGURED", country.domesticInternalStatus, country);
        return this.evaluateRule(args, rule, country);
      }
      const balanceToBalance = args.fundingMode === FundingMode.LINQA_BALANCE && args.receiveMode === ReceiveMode.LINQA_BALANCE;
      return {
        allowed: true,
        status: country.domesticInternalStatus,
        transferClass: TransferClass.INTERNAL_DOMESTIC,
        requiresFx: false,
        requiresBankRail: false,
        permittedRails: balanceToBalance
          ? [RailType.INTERNAL_LEDGER]
          : [RailType.DOMESTIC_FUNDING, RailType.LOCAL_BANK, RailType.MOBILE_MONEY, RailType.CARD_PUSH],
        permittedFundingModes: country.allowedFundingModes,
        permittedReceiveModes: country.allowedReceiveModes,
        countryPolicyId: country.id,
        countryPolicyVersion: country.version
      };
    }

    const rule = await this.repo.getActiveCorridorVersion(source, destination, args.classification.transferClass, at);
    if (!rule) return this.block(args.classification, "CORRIDOR_NOT_CONFIGURED");
    return this.evaluateRule(args, rule);
  }

  snapshot(args: {
    decision: CapabilityDecision;
    sender: SenderContext;
    recipient: ResolvedRecipient;
    amount: Money;
    fundingMode: FundingMode;
    receiveMode: ReceiveMode;
    evaluatedAt?: Date;
  }): CapabilitySnapshot {
    return {
      ...args.decision,
      evaluatedAt: (args.evaluatedAt ?? new Date()).toISOString(),
      sourceCountry: args.sender.verifiedCountry.toUpperCase(),
      destinationCountry: args.recipient.verifiedCountry.toUpperCase(),
      sourceCurrency: args.amount.currency.toUpperCase(),
      destinationCurrency: args.recipient.receiveCurrency.toUpperCase(),
      fundingMode: args.fundingMode,
      receiveMode: args.receiveMode
    };
  }

  private evaluateRule(
    args: {
      sender: SenderContext;
      recipient: ResolvedRecipient;
      classification: TransferClassification;
      amount: Money;
      fundingMode: FundingMode;
      receiveMode: ReceiveMode;
      purposeCode?: string;
    },
    rule: CorridorRuleVersion,
    country?: CountryCapabilityVersion
  ): CapabilityDecision {
    const blocked = (reasonCode: string) => this.block(args.classification, reasonCode, rule.status, country, rule);
    if (rule.status === CapabilityStatus.RECEIVE_ONLY) return blocked("OUTBOUND_NOT_ALLOWED_RECEIVE_ONLY");
    if (rule.status === CapabilityStatus.RESTRICTED) return blocked("CORRIDOR_RESTRICTED");
    if (rule.status === CapabilityStatus.TEMPORARILY_SUSPENDED) return blocked("CORRIDOR_TEMPORARILY_SUSPENDED");
    if (rule.status === CapabilityStatus.UNSUPPORTED) return blocked("CORRIDOR_UNSUPPORTED");
    if (rule.minAmountMinor !== undefined && args.amount.amountMinor < rule.minAmountMinor) return blocked("CORRIDOR_MINIMUM_NOT_MET");
    if (rule.maxAmountMinor !== undefined && args.amount.amountMinor > rule.maxAmountMinor) return blocked("CORRIDOR_LIMIT_EXCEEDED");
    if (rule.minKycLevel !== undefined && args.sender.kycLevel < rule.minKycLevel) return blocked("KYC_LEVEL_INSUFFICIENT");
    if (!rule.sourceCurrencies.includes(args.amount.currency.toUpperCase())) return blocked("SOURCE_CURRENCY_UNSUPPORTED");
    if (!rule.destinationCurrencies.includes(args.recipient.receiveCurrency.toUpperCase())) return blocked("DESTINATION_CURRENCY_UNSUPPORTED");
    if (!rule.permittedFundingModes.includes(args.fundingMode)) return blocked("FUNDING_MODE_NOT_ALLOWED");
    if (!rule.permittedReceiveModes.includes(args.receiveMode)) return blocked("RECEIVE_MODE_NOT_ALLOWED");
    if (rule.requiresPurposeCode && !args.purposeCode) return blocked("PURPOSE_CODE_REQUIRED");
    const requiresBankRail = rule.status === CapabilityStatus.BANK_OUTBOUND_ONLY;
    const permittedRails = requiresBankRail
      ? rule.permittedRails.filter((rail) => rail === RailType.LOCAL_BANK || rail === RailType.CORRESPONDENT_BANK)
      : rule.permittedRails;
    if (permittedRails.length === 0) return blocked("NO_PERMITTED_RAIL");
    return {
      allowed: true,
      status: rule.status,
      transferClass: args.classification.transferClass,
      requiresFx: !args.classification.sameCurrency,
      requiresBankRail,
      permittedRails,
      permittedFundingModes: rule.permittedFundingModes,
      permittedReceiveModes: rule.permittedReceiveModes,
      ...(country ? { countryPolicyId: country.id, countryPolicyVersion: country.version } : {}),
      corridorRuleId: rule.id,
      corridorRuleVersion: rule.version
    };
  }

  private block(
    classification: TransferClassification,
    reasonCode: string,
    status = CapabilityStatus.UNSUPPORTED,
    country?: CountryCapabilityVersion,
    rule?: CorridorRuleVersion
  ): CapabilityDecision {
    return {
      allowed: false,
      status,
      reasonCode,
      transferClass: classification.transferClass,
      requiresFx: !classification.sameCurrency,
      requiresBankRail: status === CapabilityStatus.BANK_OUTBOUND_ONLY,
      permittedRails: rule?.permittedRails ?? [],
      permittedFundingModes: rule?.permittedFundingModes ?? [],
      permittedReceiveModes: rule?.permittedReceiveModes ?? [],
      ...(country ? { countryPolicyId: country.id, countryPolicyVersion: country.version } : {}),
      ...(rule ? { corridorRuleId: rule.id, corridorRuleVersion: rule.version } : {})
    };
  }
}
