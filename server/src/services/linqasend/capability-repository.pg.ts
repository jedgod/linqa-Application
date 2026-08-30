import type { Database } from "../../db/pool.js";
import {
  CapabilityStatus,
  FundingMode,
  RailType,
  ReceiveMode,
  TransferClass,
  type CapabilityRepository,
  type CorridorRuleVersion,
  type CountryCapabilityVersion
} from "./classification-v3.js";

function optionalDate(value: unknown): Date | undefined {
  return value ? new Date(String(value)) : undefined;
}

export class PgCapabilityRepository implements CapabilityRepository {
  constructor(private readonly db: Database) {}

  async getActiveCountryVersion(country: string, at: Date): Promise<CountryCapabilityVersion | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM linqasend_country_capabilities_v3
       WHERE country = $1 AND effective_from <= $2
         AND (effective_to IS NULL OR effective_to > $2)
       ORDER BY version DESC LIMIT 1`,
      [country.toUpperCase(), at]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      country: row.country,
      version: row.version,
      effectiveFrom: new Date(row.effective_from),
      ...(optionalDate(row.effective_to) ? { effectiveTo: optionalDate(row.effective_to)! } : {}),
      domesticInternalStatus: row.domestic_internal_status as CapabilityStatus,
      domesticBankInStatus: row.domestic_bank_in_status as CapabilityStatus,
      domesticBankOutStatus: row.domestic_bank_out_status as CapabilityStatus,
      domesticMerchantStatus: row.domestic_merchant_status as CapabilityStatus,
      domesticRequestMoneyStatus: row.domestic_request_money_status as CapabilityStatus,
      crossBorderInboundStatus: row.cross_border_inbound_status as CapabilityStatus,
      crossBorderOutboundStatus: row.cross_border_outbound_status as CapabilityStatus,
      crossBorderBankOutboundStatus: row.cross_border_bank_outbound_status as CapabilityStatus,
      allowedFundingModes: row.allowed_funding_modes as FundingMode[],
      allowedReceiveModes: row.allowed_receive_modes as ReceiveMode[],
      ...(row.source_reference ? { sourceReference: row.source_reference } : {}),
      ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
      ...(row.approved_at ? { approvedAt: new Date(row.approved_at) } : {})
    };
  }

  async getActiveCorridorVersion(
    sourceCountry: string,
    destinationCountry: string,
    transferClass: TransferClass,
    at: Date
  ): Promise<CorridorRuleVersion | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM linqasend_corridor_rules_v3
       WHERE source_country = $1 AND destination_country = $2 AND transfer_class = $3
         AND effective_from <= $4 AND (effective_to IS NULL OR effective_to > $4)
       ORDER BY version DESC LIMIT 1`,
      [sourceCountry.toUpperCase(), destinationCountry.toUpperCase(), transferClass, at]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      sourceCountry: row.source_country,
      destinationCountry: row.destination_country,
      transferClass: row.transfer_class as TransferClass,
      version: row.version,
      status: row.status as CapabilityStatus,
      effectiveFrom: new Date(row.effective_from),
      ...(optionalDate(row.effective_to) ? { effectiveTo: optionalDate(row.effective_to)! } : {}),
      sourceCurrencies: row.source_currencies as string[],
      destinationCurrencies: row.destination_currencies as string[],
      permittedFundingModes: row.permitted_funding_modes as FundingMode[],
      permittedReceiveModes: row.permitted_receive_modes as ReceiveMode[],
      permittedRails: row.permitted_rails as RailType[],
      ...(row.min_amount_minor !== null ? { minAmountMinor: BigInt(row.min_amount_minor) } : {}),
      ...(row.max_amount_minor !== null ? { maxAmountMinor: BigInt(row.max_amount_minor) } : {}),
      ...(row.min_kyc_level !== null ? { minKycLevel: row.min_kyc_level } : {}),
      requiresPurposeCode: row.requires_purpose_code,
      requiresSourceOfFunds: row.requires_source_of_funds,
      requiresManualReview: row.requires_manual_review,
      ...(row.provider_id ? { providerId: row.provider_id } : {})
    };
  }
}
