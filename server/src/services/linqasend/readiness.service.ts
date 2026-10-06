import { createHash } from "node:crypto";
import type { Database } from "../../db/pool.js";
import { PgCapabilityRepository } from "./capability-repository.pg.js";
import { FundingMode, ReceiveMode, RecipientType, RegulatoryCapabilityEngine, TransferClassifier, type SenderContext } from "./classification-v3.js";
import { JurisdictionV2Service } from "./jurisdiction-v2.js";
import { RegulatedEntityResolverV7, snapshotSha256 } from "./regulatory-v7.js";
import { SettlementTreasuryV5Service } from "./settlement-v5.js";
import { LINQASEND_WORKERS } from "./worker-supervisor.service.js";

function fundingMode(type: string): FundingMode {
  if (type === "BANK_ACCOUNT") return FundingMode.BANK;
  if (type === "DEBIT_CARD") return FundingMode.DEBIT_CARD;
  if (type === "CREDIT_CARD") return FundingMode.CREDIT_CARD;
  if (type === "MOBILE_WALLET") return FundingMode.MOBILE_MONEY;
  throw new Error("FUNDING_MODE_UNSUPPORTED");
}

export class LinqaSendReadinessService {
  private readonly capabilities: RegulatoryCapabilityEngine;
  private readonly classifier = new TransferClassifier();
  private readonly jurisdiction: JurisdictionV2Service;
  private readonly regulatory: RegulatedEntityResolverV7;
  private readonly settlement: SettlementTreasuryV5Service;
  constructor(private readonly db: Database, private readonly release?: { gitSha: string; artifactDigest: string }, private readonly runtime: { realMoneyEnabled?: boolean; mode?: "SANDBOX_CERTIFICATION"|"LIMITED_LAUNCH"|"GENERAL_AVAILABILITY"; limitedCorridorId?: string } = {}) {
    this.capabilities = new RegulatoryCapabilityEngine(new PgCapabilityRepository(db));
    this.jurisdiction = new JurisdictionV2Service(db);
    this.regulatory = new RegulatedEntityResolverV7(db);
    this.settlement = new SettlementTreasuryV5Service(db);
  }

  async evaluate(args: { userId: string; recipientId: string; paymentMethodId: string; sourceAmountMinor: bigint; sourceCurrency: string; destinationCurrency: string; purposeCode?: string }): Promise<{
    ready: boolean; blockers: string[]; transferClass: string; fundingMode: FundingMode; receiveMode: ReceiveMode;
    sourceCountry: string; destinationCountry: string; senderLegalName: string; capabilitySnapshot: Record<string, unknown>; responsibilityResolution: Record<string, unknown>;
  }> {
    const profile = await this.jurisdiction.getProfile(args.userId);
    const [recipientResult, methodResult, complianceResult] = await Promise.all([
      this.db.query(`SELECT * FROM linqasend_recipients WHERE id=$1 AND owner_user_id=$2`, [args.recipientId, args.userId]),
      this.db.query(`SELECT * FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND verification_status='VERIFIED'`, [args.paymentMethodId, args.userId]),
      this.db.query(`SELECT * FROM linqasend_customer_compliance_profiles_v7 WHERE user_id=$1 AND kyc_status='VERIFIED' AND (expires_at IS NULL OR expires_at>now())`, [args.userId])
    ]);
    const recipientRow = recipientResult.rows[0], method = methodResult.rows[0], compliance = complianceResult.rows[0];
    if (!recipientRow) throw new Error("RECIPIENT_NOT_FOUND");
    if (!method) throw new Error("VERIFIED_FUNDING_SOURCE_NOT_FOUND");
    if (!compliance) throw new Error("VERIFIED_CUSTOMER_COMPLIANCE_PROFILE_REQUIRED");
    if (compliance.verified_country !== profile.regulatoryJurisdiction) throw new Error("KYC_JURISDICTION_MISMATCH");
    const sender: SenderContext = { userId: args.userId, verifiedCountry: profile.regulatoryJurisdiction, baseCurrency: args.sourceCurrency.toUpperCase(), kycLevel: compliance.kyc_level, kycStatus: compliance.kyc_status, riskScore: 0, deviceTrust: "UNKNOWN", accountStatus: "ACTIVE" };
    const externalType = String(recipientRow.recipient_type);
    const resolvedRecipientType = externalType === "LINQA_USER" ? RecipientType.LINQA_USER : externalType === "MOBILE_WALLET" ? RecipientType.MOBILE_MONEY_RECIPIENT : externalType === "CARD" ? RecipientType.CARD_RECIPIENT : RecipientType.BANK_RECIPIENT;
    const resolvedReceiveMode = externalType === "LINQA_USER" ? ReceiveMode.LINQA_BALANCE : externalType === "MOBILE_WALLET" ? ReceiveMode.MOBILE_MONEY : externalType === "CARD" ? ReceiveMode.CARD : ReceiveMode.BANK;
    const recipient = { recipientType: resolvedRecipientType, recipientId: recipientRow.id, ...(recipientRow.linqa_user_id ? { userId: recipientRow.linqa_user_id } : {}), verifiedCountry: recipientRow.country, receiveCurrency: recipientRow.preferred_currency, receiveMode: resolvedReceiveMode, verified: externalType === "LINQA_USER" || Boolean(recipientRow.payout_profile_ref && recipientRow.payout_provider) };
    if (recipient.receiveCurrency !== args.destinationCurrency.toUpperCase()) throw new Error("DESTINATION_CURRENCY_NOT_RECIPIENT_AUTHORIZED");
    const classification = this.classifier.classify(sender, recipient);
    const resolvedFundingMode = fundingMode(method.type);
    const capability = await this.capabilities.decide({ sender, recipient, classification, amount: { amountMinor: args.sourceAmountMinor, currency: args.sourceCurrency.toUpperCase() }, fundingMode: resolvedFundingMode, receiveMode: recipient.receiveMode, ...(args.purposeCode ? { purposeCode: args.purposeCode } : {}) });
    const capabilitySnapshot = this.capabilities.snapshot({ decision: capability, sender, recipient, amount: { amountMinor: args.sourceAmountMinor, currency: args.sourceCurrency }, fundingMode: resolvedFundingMode, receiveMode: recipient.receiveMode });
    const blockers: string[] = [];
    if (this.runtime.realMoneyEnabled !== true) blockers.push("REAL_MONEY_DISABLED");
    const globalKill = await this.db.query(`SELECT active FROM linqasend_kill_switches WHERE scope_type='GLOBAL' AND scope_id='*'`);
    if (globalKill.rows[0]?.active !== false) blockers.push("GLOBAL_KILL_SWITCH_ACTIVE_OR_MISSING");
    if (this.runtime.realMoneyEnabled === true) {
      const heartbeats = await this.db.query(`SELECT worker_name FROM linqasend_worker_heartbeats WHERE status='READY' AND last_heartbeat_at>now()-interval '2 minutes'`);
      const healthy = new Set(heartbeats.rows.map((row) => row.worker_name as string));
      for (const worker of LINQASEND_WORKERS) if (!healthy.has(worker)) blockers.push(`WORKER_NOT_READY:${worker}`);
      const plaintext = await this.db.query(`SELECT (SELECT count(*) FROM linqasend_payment_methods WHERE verification_status='VERIFIED' AND deleted_at IS NULL AND provider_payment_method_ref NOT LIKE 'vault:%')+(SELECT count(*) FROM linqasend_payout_endpoints_v1 WHERE status='ACTIVE' AND provider_token NOT LIKE 'vault:%') AS count`);
      if (Number(plaintext.rows[0]?.count??0)>0) blockers.push("PLAINTEXT_PROVIDER_REFERENCE_MIGRATION_INCOMPLETE");
    }
    if (!capability.allowed) blockers.push(capability.reasonCode ?? "CAPABILITY_DENIED");
    const resolution = await this.regulatory.resolve({ sourceCountry: profile.regulatoryJurisdiction, destinationCountry: recipient.verifiedCountry, transferClass: classification.transferClass, sourceCurrency: args.sourceCurrency, destinationCurrency: args.destinationCurrency, fundingMode: resolvedFundingMode, receiveMode: recipient.receiveMode });
    if (!resolution.complete) blockers.push(...resolution.blockedReasons, ...resolution.missingResponsibilities.map((r) => `MISSING_RESPONSIBILITY:${r}`));
    if (capability.allowed) {
      const position = await this.settlement.calculatePosition(args.destinationCurrency);
      const liquidity = await this.settlement.assertLiquidity(args.destinationCurrency, position.availableLiquidityMinor);
      if (!liquidity.allowNewTransfers) blockers.push(`LIQUIDITY_${liquidity.state}`);
    }
    if (this.release) {
      let corridorRuleId = capability.corridorRuleId;
      let providerId: string | undefined;
      if (!corridorRuleId) {
        const certifiableRule = await this.db.query(`SELECT id,provider_id FROM linqasend_corridor_rules_v3 WHERE source_country=$1 AND destination_country=$2 AND transfer_class=$3 AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY version DESC LIMIT 1`, [profile.regulatoryJurisdiction, recipient.verifiedCountry, classification.transferClass]);
        corridorRuleId = certifiableRule.rows[0]?.id;
        providerId = certifiableRule.rows[0]?.provider_id;
      } else {
        const provider = await this.db.query(`SELECT provider_id FROM linqasend_corridor_rules_v3 WHERE id=$1`, [corridorRuleId]);
        providerId = provider.rows[0]?.provider_id;
      }
      if (!corridorRuleId) blockers.push("CERTIFIABLE_CORRIDOR_RULE_REQUIRED");
      else {
        const certificate = await this.db.query(`SELECT 1 FROM linqasend_corridor_certifications_v6 WHERE corridor_rule_id=$1 AND git_sha=$2 AND status='CERTIFIED' AND physical_tests_passed=true AND failure_tests_passed=true AND expires_at>now()`, [corridorRuleId, this.release.gitSha.toLowerCase()]);
        if (!certificate.rows[0]) blockers.push("CORRIDOR_EXACT_SHA_CERTIFICATION_REQUIRED");
      }
      if (!providerId) blockers.push("CERTIFIED_PROVIDER_ROUTE_REQUIRED");
      else {
        const providerCertificate = await this.db.query(`SELECT 1 FROM linqasend_provider_certifications_v6 WHERE provider_id=$1 AND git_sha=$2 AND status='CERTIFIED' AND expires_at>now()`, [providerId, this.release.gitSha.toLowerCase()]);
        if (!providerCertificate.rows[0]) blockers.push(`PROVIDER_NOT_CERTIFIED:${providerId}`);
      }
      const releaseManifest = await this.db.query(`SELECT 1 FROM linqasend_release_manifests_v6 WHERE git_sha=$1 AND artifact_digest=$2 AND status='APPROVED'`, [this.release.gitSha.toLowerCase(), this.release.artifactDigest]);
      if (!releaseManifest.rows[0]) blockers.push("DEPLOYED_ARTIFACT_NOT_APPROVED");
      if (this.runtime.mode === "LIMITED_LAUNCH") {
        if (!this.runtime.limitedCorridorId || corridorRuleId !== this.runtime.limitedCorridorId) blockers.push("LIMITED_LAUNCH_CORRIDOR_MISMATCH");
        if (resolvedFundingMode !== FundingMode.BANK || recipient.receiveMode !== ReceiveMode.BANK) blockers.push("LIMITED_LAUNCH_BANK_ONLY");
        const cohort = await this.db.query(`SELECT c.id,c.per_transfer_limit_minor,c.daily_user_limit_minor FROM linqasend_launch_cohorts c JOIN linqasend_launch_cohort_members m ON m.cohort_id=c.id AND m.user_id=$1 AND m.removed_at IS NULL WHERE c.status='ACTIVE' AND $2::uuid=ANY(c.corridor_rule_ids) AND 'BANK'=ANY(c.allowed_funding_modes) LIMIT 1`, [args.userId,corridorRuleId ?? null]);
        if (!cohort.rows[0]) blockers.push("ACTIVE_LIMITED_LAUNCH_COHORT_REQUIRED");
        else {
          if (args.sourceAmountMinor > BigInt(cohort.rows[0].per_transfer_limit_minor)) blockers.push("COHORT_PER_TRANSFER_LIMIT_EXCEEDED");
          const used = await this.db.query(`SELECT coalesce(sum(send_amount_minor),0)::bigint AS amount FROM linqasend_transfers WHERE user_id=$1 AND created_at>now()-interval '24 hours' AND status NOT IN ('DECLINED','CANCELED','EXPIRED','FAILED')`,[args.userId]);
          if (BigInt(used.rows[0]?.amount??0)+args.sourceAmountMinor>BigInt(cohort.rows[0].daily_user_limit_minor)) blockers.push("COHORT_DAILY_LIMIT_EXCEEDED");
          const approval = await this.db.query(`SELECT count(DISTINCT a.approval_role)::int AS approvals,count(*) FILTER(WHERE a.decision='REJECT')::int AS rejections FROM linqasend_launch_approval_requests r JOIN linqasend_release_manifests_v6 m ON m.id=r.release_manifest_id JOIN linqasend_launch_approvals a ON a.request_id=r.id WHERE r.cohort_id=$1 AND r.status='APPROVED' AND m.git_sha=$2 AND m.artifact_digest=$3`,[cohort.rows[0].id,this.release.gitSha.toLowerCase(),this.release.artifactDigest]);
          if (Number(approval.rows[0]?.approvals)!==6 || Number(approval.rows[0]?.rejections)!==0) blockers.push("SIX_ROLE_LAUNCH_APPROVAL_REQUIRED");
        }
      }
    }
    const uniqueBlockers=[...new Set(blockers)];
    const snapshotBody={userId:args.userId,sourceCountry:profile.regulatoryJurisdiction,destinationCountry:recipient.verifiedCountry,transferClass:classification.transferClass,fundingMode:resolvedFundingMode,receiveMode:recipient.receiveMode,blockers:uniqueBlockers};
    const snapshotHash=createHash("sha256").update(JSON.stringify(snapshotBody)).digest("hex");
    await this.db.query(`INSERT INTO linqasend_readiness_snapshots(scope_type,scope_id,release_git_sha,artifact_sha256,ready,checks,blockers,snapshot_hash) VALUES('USER_TRANSFER',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT(snapshot_hash) DO NOTHING`,[args.userId,this.release?.gitSha??null,this.release?.artifactDigest??null,uniqueBlockers.length===0,JSON.stringify(snapshotBody),uniqueBlockers,snapshotHash]);
    return { ready: uniqueBlockers.length === 0, blockers: uniqueBlockers, transferClass: classification.transferClass, fundingMode: resolvedFundingMode, receiveMode: recipient.receiveMode, sourceCountry: profile.regulatoryJurisdiction, destinationCountry: recipient.verifiedCountry, senderLegalName: compliance.verified_legal_name, capabilitySnapshot: capabilitySnapshot as unknown as Record<string, unknown>, responsibilityResolution: resolution as unknown as Record<string, unknown> };
  }

  async persistTransferReadiness(transferId: string, result: Awaited<ReturnType<LinqaSendReadinessService["evaluate"]>>): Promise<void> {
    const capabilityJson = JSON.stringify(result.capabilitySnapshot);
    const capabilityHash = createHash("sha256").update(capabilityJson).digest("hex");
    const resolution = result.responsibilityResolution as { responsibilityMapId?: string; policyVersion?: number; complete?: boolean; blockedReasons?: string[] };
    const snapshot = await this.db.query(`INSERT INTO linqasend_responsibility_snapshots_v7(transfer_id,responsibility_map_id,policy_version,resolution,snapshot_hash,complete,blocked_reasons) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [transferId, resolution.responsibilityMapId && resolution.responsibilityMapId !== "NONE" ? resolution.responsibilityMapId : null, resolution.policyVersion ?? 0, JSON.stringify(result.responsibilityResolution), snapshotSha256(result.responsibilityResolution), Boolean(resolution.complete), resolution.blockedReasons ?? []]);
    await this.db.query(`UPDATE linqasend_transfers SET transfer_class=$2,funding_mode=$3,receive_mode=$4,source_country=$5,destination_country=$6,capability_snapshot=$7,capability_snapshot_hash=$8,responsibility_snapshot_id=$9,real_money_ready=$10 WHERE id=$1`, [transferId, result.transferClass, result.fundingMode, result.receiveMode, result.sourceCountry, result.destinationCountry, capabilityJson, capabilityHash, snapshot.rows[0].id, result.ready]);
  }
}
