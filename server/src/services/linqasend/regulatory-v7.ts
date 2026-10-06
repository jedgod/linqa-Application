import { createHash } from "node:crypto";
import type { Database } from "../../db/pool.js";

export type FinancialResponsibility = "CUSTOMER_ONBOARDING" | "KYC_CIP" | "AML_MONITORING" | "SANCTIONS_SCREENING" | "ACCEPT_CUSTOMER_FUNDS" | "CUSTOMER_FUNDS_CUSTODY" | "SAFEGUARDING" | "CUSTOMER_ACCOUNT_ISSUER" | "STORED_VALUE_ISSUER" | "DOMESTIC_TRANSMISSION" | "CROSS_BORDER_TRANSMISSION" | "FX_EXECUTION" | "CARD_ACQUIRING" | "BANK_DEBIT" | "MOBILE_MONEY_PAYOUT" | "CARD_PUSH_PAYOUT" | "LOCAL_BANK_PAYOUT" | "DISPUTES" | "CHARGEBACKS" | "REFUNDS" | "SETTLEMENT" | "RECONCILIATION";
export type CustodyModel = "NO_CUSTOMER_FUNDS" | "PARTNER_CUSTODY" | "FBO_OR_EQUIVALENT_PARTNER_ACCOUNT" | "PARTNER_ISSUED_STORED_VALUE" | "PASS_THROUGH_ONLY";
export type ResponsibilityRequirement = "REQUIRED" | "OPTIONAL" | "NOT_APPLICABLE";

const responsibilities: FinancialResponsibility[] = ["CUSTOMER_ONBOARDING", "KYC_CIP", "AML_MONITORING", "SANCTIONS_SCREENING", "ACCEPT_CUSTOMER_FUNDS", "CUSTOMER_FUNDS_CUSTODY", "SAFEGUARDING", "CUSTOMER_ACCOUNT_ISSUER", "STORED_VALUE_ISSUER", "DOMESTIC_TRANSMISSION", "CROSS_BORDER_TRANSMISSION", "FX_EXECUTION", "CARD_ACQUIRING", "BANK_DEBIT", "MOBILE_MONEY_PAYOUT", "CARD_PUSH_PAYOUT", "LOCAL_BANK_PAYOUT", "DISPUTES", "CHARGEBACKS", "REFUNDS", "SETTLEMENT", "RECONCILIATION"];

/**
 * Key-order-independent JSON. The previous snapshot hash passed a sorted key list
 * as the JSON.stringify replacer, which also filters NESTED keys, so every
 * authority serialized as {} and the hash did not cover who was authorized.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function snapshotSha256(resolution: unknown): string {
  return createHash("sha256").update(canonicalJson(resolution)).digest("hex");
}

export class ResponsibilityRequirementService {
  derive(args: { transferClass: string; fundingMode: string; receiveMode: string; sourceCurrency: string; destinationCurrency: string; custodyModel: CustodyModel }): Record<FinancialResponsibility, ResponsibilityRequirement> {
    const crossBorder = ["INTERNAL_CROSS_BORDER", "EXTERNAL_CROSS_BORDER"].includes(args.transferClass);
    const cardFunding = ["DEBIT_CARD", "CREDIT_CARD"].includes(args.fundingMode);
    return {
      CUSTOMER_ONBOARDING: "REQUIRED", KYC_CIP: "REQUIRED", AML_MONITORING: "REQUIRED", SANCTIONS_SCREENING: "REQUIRED",
      ACCEPT_CUSTOMER_FUNDS: args.fundingMode === "LINQA_BALANCE" ? "OPTIONAL" : "REQUIRED",
      CUSTOMER_FUNDS_CUSTODY: args.custodyModel === "NO_CUSTOMER_FUNDS" ? "NOT_APPLICABLE" : "REQUIRED",
      SAFEGUARDING: ["PARTNER_CUSTODY", "FBO_OR_EQUIVALENT_PARTNER_ACCOUNT", "PARTNER_ISSUED_STORED_VALUE"].includes(args.custodyModel) ? "REQUIRED" : "NOT_APPLICABLE",
      CUSTOMER_ACCOUNT_ISSUER: args.receiveMode === "LINQA_BALANCE" ? "REQUIRED" : "OPTIONAL",
      STORED_VALUE_ISSUER: args.receiveMode === "LINQA_BALANCE" ? "REQUIRED" : "NOT_APPLICABLE",
      DOMESTIC_TRANSMISSION: crossBorder ? "NOT_APPLICABLE" : "REQUIRED", CROSS_BORDER_TRANSMISSION: crossBorder ? "REQUIRED" : "NOT_APPLICABLE",
      FX_EXECUTION: args.sourceCurrency.toUpperCase() !== args.destinationCurrency.toUpperCase() ? "REQUIRED" : "NOT_APPLICABLE",
      CARD_ACQUIRING: cardFunding ? "REQUIRED" : "NOT_APPLICABLE", BANK_DEBIT: args.fundingMode === "BANK" ? "REQUIRED" : "NOT_APPLICABLE",
      MOBILE_MONEY_PAYOUT: args.receiveMode === "MOBILE_MONEY" ? "REQUIRED" : "NOT_APPLICABLE",
      CARD_PUSH_PAYOUT: args.receiveMode === "CARD" ? "REQUIRED" : "NOT_APPLICABLE", LOCAL_BANK_PAYOUT: args.receiveMode === "BANK" ? "REQUIRED" : "NOT_APPLICABLE",
      DISPUTES: "REQUIRED", CHARGEBACKS: cardFunding ? "REQUIRED" : "OPTIONAL", REFUNDS: "REQUIRED", SETTLEMENT: "REQUIRED", RECONCILIATION: "REQUIRED"
    };
  }
}

export interface FinancialExecutionAuthority { responsibility: FinancialResponsibility; providerAdapterKey: string | null; entityId: string; legalName: string; entityType: string; countryCode: string; contractId: string; contractStatus: string; regulatoryReference?: string; operationalStatus: string }
export interface RegulatedEntityResolution { responsibilityMapId: string; policyVersion: number; sourceCountry: string; destinationCountry: string; transferClass: string; custodyModel: CustodyModel; authorities: FinancialExecutionAuthority[]; legalApprovalReference: string; partnerApprovalReference: string; effectiveAt: string; complete: boolean; missingResponsibilities: FinancialResponsibility[]; blockedReasons: string[] }

export class RegulatedEntityResolverV7 {
  private readonly requirements = new ResponsibilityRequirementService();
  constructor(private readonly db: Database) {}

  async resolve(args: { sourceCountry: string; destinationCountry: string; transferClass: string; sourceCurrency: string; destinationCurrency: string; fundingMode: string; receiveMode: string; at?: Date }): Promise<RegulatedEntityResolution> {
    const at = args.at ?? new Date();
    const mapResult = await this.db.query(
      `SELECT * FROM linqasend_financial_responsibility_maps_v7
       WHERE source_country=$1 AND destination_country=$2 AND transfer_class=$3 AND source_currency=$4 AND destination_currency=$5
         AND funding_mode=$6 AND receive_mode=$7 AND status='ACTIVE' AND effective_from<=$8 AND (effective_to IS NULL OR effective_to>$8)
       ORDER BY policy_version DESC LIMIT 1`,
      [args.sourceCountry.toUpperCase(), args.destinationCountry.toUpperCase(), args.transferClass, args.sourceCurrency.toUpperCase(), args.destinationCurrency.toUpperCase(), args.fundingMode, args.receiveMode, at]
    );
    const map = mapResult.rows[0];
    if (!map) return this.missingMap(args, at);
    if (!map.legal_approval_reference || !map.partner_approval_reference) return { ...this.missingMap(args, at), responsibilityMapId: map.id, policyVersion: map.policy_version, custodyModel: map.custody_model, blockedReasons: ["APPROVAL_REFERENCES_MISSING"] };
    const required = this.requirements.derive({ ...args, custodyModel: map.custody_model as CustodyModel });
    const authorities: FinancialExecutionAuthority[] = [];
    const missing: FinancialResponsibility[] = [];
    const blockedReasons: string[] = [];
    const entityMap = map.responsibility_entities as Partial<Record<FinancialResponsibility, string>>;
    for (const responsibility of responsibilities) {
      const requirement = required[responsibility];
      if (requirement === "NOT_APPLICABLE") continue;
      const entityId = entityMap[responsibility];
      if (!entityId) { if (requirement === "REQUIRED") missing.push(responsibility); continue; }
      const entityResult = await this.db.query(`SELECT e.*,coalesce(h.operational_status,e.operational_status) AS current_operational_status FROM linqasend_financial_entities_v7 e LEFT JOIN LATERAL (SELECT operational_status FROM linqasend_partner_health_v7 WHERE entity_id=e.id ORDER BY checked_at DESC LIMIT 1) h ON true WHERE e.id=$1`, [entityId]);
      const entity = entityResult.rows[0];
      if (!entity) { missing.push(responsibility); blockedReasons.push(`ENTITY_NOT_FOUND:${responsibility}:${entityId}`); continue; }
      if (entity.status !== "ACTIVE") { blockedReasons.push(`ENTITY_NOT_ACTIVE:${responsibility}:${entityId}`); continue; }
      if (entity.due_diligence_status !== "APPROVED") { blockedReasons.push(`ENTITY_DUE_DILIGENCE_NOT_APPROVED:${entityId}`); continue; }
      const contractResult = await this.db.query(
        `SELECT * FROM linqasend_partner_contracts_v7 WHERE entity_id=$1 AND $2=ANY(responsibilities) AND status='ACTIVE'
         AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>$3)
         AND ($4=ANY(source_countries) OR cardinality(source_countries)=0) AND ($5=ANY(destination_countries) OR cardinality(destination_countries)=0)
         AND ($6=ANY(currencies) OR cardinality(currencies)=0) AND ($7=ANY(currencies) OR cardinality(currencies)=0)
         ORDER BY effective_from DESC LIMIT 1`,
        [entityId, responsibility, at, args.sourceCountry.toUpperCase(), args.destinationCountry.toUpperCase(), args.sourceCurrency.toUpperCase(), args.destinationCurrency.toUpperCase()]
      );
      const contract = contractResult.rows[0];
      if (!contract) { missing.push(responsibility); blockedReasons.push(`CONTRACT_NOT_FOUND:${responsibility}:${entityId}`); continue; }
      if (["DOWN", "UNKNOWN"].includes(entity.current_operational_status)) { blockedReasons.push(`PARTNER_OPERATIONALLY_UNAVAILABLE:${responsibility}:${entityId}`); continue; }
      authorities.push({ responsibility, providerAdapterKey: contract.provider_adapter_key ?? null, entityId, legalName: entity.legal_name, entityType: entity.entity_type, countryCode: entity.country_code, contractId: contract.id, contractStatus: contract.status, ...(entity.regulatory_reference ? { regulatoryReference: entity.regulatory_reference } : {}), operationalStatus: entity.current_operational_status });
    }
    return { responsibilityMapId: map.id, policyVersion: map.policy_version, sourceCountry: args.sourceCountry, destinationCountry: args.destinationCountry, transferClass: args.transferClass, custodyModel: map.custody_model, authorities, legalApprovalReference: map.legal_approval_reference, partnerApprovalReference: map.partner_approval_reference, effectiveAt: at.toISOString(), complete: missing.length === 0 && blockedReasons.length === 0, missingResponsibilities: [...new Set(missing)], blockedReasons };
  }

  async assertAndSnapshot(transferId: string, args: Parameters<RegulatedEntityResolverV7["resolve"]>[0]): Promise<RegulatedEntityResolution> {
    const resolution = await this.resolve(args);
    const hash = snapshotSha256(resolution);
    await this.db.query(`INSERT INTO linqasend_responsibility_snapshots_v7(transfer_id,responsibility_map_id,policy_version,resolution,snapshot_hash,complete,blocked_reasons) VALUES($1,$2,$3,$4,$5,$6,$7)`, [transferId, resolution.responsibilityMapId === "NONE" ? null : resolution.responsibilityMapId, resolution.policyVersion, JSON.stringify(resolution), hash, resolution.complete, resolution.blockedReasons]);
    if (!resolution.complete) throw new Error(`REAL_MONEY_NOT_READY:${resolution.blockedReasons[0] ?? resolution.missingResponsibilities[0] ?? "RESPONSIBILITY_INCOMPLETE"}`);
    return resolution;
  }

  private missingMap(args: { sourceCountry: string; destinationCountry: string; transferClass: string }, at: Date): RegulatedEntityResolution {
    return { responsibilityMapId: "NONE", policyVersion: 0, sourceCountry: args.sourceCountry, destinationCountry: args.destinationCountry, transferClass: args.transferClass, custodyModel: "NO_CUSTOMER_FUNDS", authorities: [], legalApprovalReference: "", partnerApprovalReference: "", effectiveAt: at.toISOString(), complete: false, missingResponsibilities: [], blockedReasons: ["FINANCIAL_RESPONSIBILITY_MAP_NOT_CONFIGURED"] };
  }
}
