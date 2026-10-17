import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import type { LinqaSendProviders } from "../../integrations/linqasend/provider.contracts.js";
import { ComplianceService } from "./compliance.service.js";
import { LedgerService } from "./ledger.service.js";
import { RiskEngineService } from "./risk-engine.service.js";
import { assertTransition } from "./transfer-state.js";
import { AtomicCompletionService } from "./atomic-completion.service.js";
import { ProviderOperationService } from "./provider-operation.service.js";
import { ResponsibilityError, ResponsibilityExecutionGuard } from "./v7-execution-guard.js";
import type { ProviderTokenVaultService } from "./provider-token-vault.service.js";
import { LinqaSendExecutionQueue } from "./execution-queue.service.js";

function publicTransferId(): string {
  return `LS${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 6).toUpperCase()}`;
}

export class TransferOrchestratorService {
  private readonly compliance: ComplianceService;
  private readonly completion: AtomicCompletionService;
  private readonly operations: ProviderOperationService;
  private readonly executionQueue: LinqaSendExecutionQueue;
  private readonly responsibility: ResponsibilityExecutionGuard;

  constructor(
    private readonly db: Database,
    private readonly risk: RiskEngineService,
    _ledger: LedgerService,
    private readonly providers: LinqaSendProviders,
    private readonly tokenVault?: ProviderTokenVaultService
  ) {
    this.compliance = new ComplianceService(providers.compliance);
    this.completion = new AtomicCompletionService(db);
    this.operations = new ProviderOperationService(db);
    this.executionQueue = new LinqaSendExecutionQueue(db);
    this.responsibility = new ResponsibilityExecutionGuard(db);
  }

  /**
   * Creates the transfer row and drives it through compliance -> risk ->
   * funding authorization -> payout exactly like the pack's orchestrator,
   * adapted to persist real state at every step (so a client can poll
   * `GET /v1/linqasend/transfers/:id` and see genuine progress) instead of
   * only returning a final in-memory result. Idempotent on
   * (user_id, idempotency_key): a retried request with the same key returns
   * the original transfer instead of creating a second one.
   */
  async createTransfer(input: {
    internalId?: string;
    beforeAdvance?: (transferId: string) => Promise<void>;
    deferExecution?: boolean;
    userId: string;
    quote: {
      id: string;
      recipientId: string;
      sendAmountMinor: string;
      senderFeeMinor?: string;
      sendCurrency: string;
      receiveAmountMinor: string;
      receiveCurrency: string;
      customerRate: string;
      marginBps: number;
      provider: string;
    };
    recipient: { id: string; displayName: string; country: string; providerRecipientRef: string };
    paymentMethodId: string | null;
    paymentMethodRef?: string | undefined;
    idempotencyKey: string;
    purposeCode?: string | undefined;
    authContext: {
      stepUpVerified: boolean;
      deviceTrusted: boolean;
      accountAgeDays: number;
      recentPasswordReset: boolean;
      recentSimChange: boolean;
      velocity24hMinor: bigint;
      isNewRecipient: boolean;
      isNewPaymentMethod: boolean;
      countryRiskScore: number;
    };
    senderLegalName: string;
    senderCountry: string;
  }) {
    if (!input.idempotencyKey || input.idempotencyKey.length < 16) {
      throw new Error("VALID_IDEMPOTENCY_KEY_REQUIRED");
    }

    const existing = await this.db.query(
      `SELECT public_id, status FROM linqasend_transfers WHERE user_id = $1 AND idempotency_key = $2`,
      [input.userId, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      return { transferId: existing.rows[0].public_id as string, status: existing.rows[0].status as string, idempotentReplay: true };
    }

    const id = input.internalId ?? randomUUID();
    const publicId = publicTransferId();

    await this.db.query(
      `INSERT INTO linqasend_transfers(
         id, public_id, user_id, recipient_id, quote_id, payment_method_id, status,
         send_amount_minor, send_currency, receive_amount_minor, receive_currency,
         customer_rate, margin_bps, purpose_code, provider, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        publicId,
        input.userId,
        input.recipient.id,
        input.quote.id,
        input.paymentMethodId,
        input.quote.sendAmountMinor,
        input.quote.sendCurrency,
        input.quote.receiveAmountMinor,
        input.quote.receiveCurrency,
        input.quote.customerRate,
        input.quote.marginBps,
        input.purposeCode ?? null,
        input.quote.provider,
        input.idempotencyKey
      ]
    );

    // Persist immutable jurisdiction/capability/responsibility evidence
    // before compliance, funding, ledger, or payout can run.
    if (input.beforeAdvance) {
      try {
        await input.beforeAdvance(id);
      } catch (error) {
        await this.db.query(`UPDATE linqasend_transfers SET status='FAILED',failure_code='READINESS_SNAPSHOT_FAILED',failure_message=$2,updated_at=now() WHERE id=$1`, [id, error instanceof Error ? error.message : "unknown"]);
        throw error;
      }
    }

    if (input.deferExecution) {
      const executionId = await this.executionQueue.enqueue(id, {
        ...input,
        internalId: id,
        beforeAdvance: undefined,
        authContext: { ...input.authContext, velocity24hMinor: input.authContext.velocity24hMinor.toString() }
      });
      return { transferId: publicId, executionId, status: "QUEUED", idempotentReplay: false };
    }
    const result = await this.advance(id, publicId, input);
    return { transferId: publicId, ...result, idempotentReplay: false };
  }

  async runClaimedExecution(claim: { id: string; transferId: string; context: any }): Promise<void> {
    const input = claim.context as Parameters<TransferOrchestratorService["createTransfer"]>[0];
    input.authContext.velocity24hMinor = BigInt(input.authContext.velocity24hMinor as unknown as string);
    const transfer = await this.db.query(`SELECT public_id,status FROM linqasend_transfers WHERE id=$1`,[claim.transferId]);
    if (!transfer.rows[0] || transfer.rows[0].status !== "CREATED") throw new Error("QUEUED_TRANSFER_NOT_EXECUTABLE");
    await this.advance(claim.transferId,transfer.rows[0].public_id,input);
  }

  private async setStatus(
    id: string,
    from: string,
    to: string,
    extra: { failureCode?: string | undefined; failureMessage?: string | undefined } = {}
  ) {
    assertTransition(from, to);
    await this.db.query(
      `UPDATE linqasend_transfers
       SET status = $2::linqasend_transfer_status, failure_code = $3, failure_message = $4, updated_at = now(),
           completed_at = CASE WHEN $2::text = 'COMPLETED' THEN now() ELSE completed_at END
       WHERE id = $1`,
      [id, to, extra.failureCode ?? null, extra.failureMessage ?? null]
    );
  }

  private async recordAttempt(
    transferId: string,
    phase: string,
    status: string,
    extra: {
      provider?: string | undefined;
      providerRef?: string | undefined;
      errorCode?: string | undefined;
      errorMessage?: string | undefined;
    } = {}
  ) {
    await this.db.query(
      `INSERT INTO linqasend_transfer_attempts(transfer_id, phase, provider, provider_ref, status, error_code, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [transferId, phase, extra.provider ?? null, extra.providerRef ?? null, status, extra.errorCode ?? null, extra.errorMessage ?? null]
    );
  }

  private async advance(
    id: string,
    publicId: string,
    input: Parameters<TransferOrchestratorService["createTransfer"]>[0]
  ): Promise<{ status: string; reason?: string | undefined; action?: string | undefined }> {
    await this.setStatus(id, "CREATED", "QUOTE_CREATED");
    await this.setStatus(id, "QUOTE_CREATED", "AWAITING_CONFIRMATION");
    await this.setStatus(id, "AWAITING_CONFIRMATION", "AUTHENTICATING");
    await this.setStatus(id, "AUTHENTICATING", "COMPLIANCE_SCREENING");

    const kyc = await this.providers.kyc.verifyIdentity({
      legalName: input.senderLegalName,
      country: input.senderCountry
    });
    await this.db.query(
      `INSERT INTO linqasend_compliance_checks(transfer_id, subject_type, provider, decision, reasons)
       VALUES ($1,'SENDER',$2,$3,$4)`,
      [id, "kyc", kyc.decision, JSON.stringify(kyc.reasons)]
    );
    if (kyc.decision === "FAIL") {
      await this.setStatus(id, "COMPLIANCE_SCREENING", "DECLINED", { failureCode: "KYC_FAIL" });
      return { status: "DECLINED", reason: "KYC_FAIL" };
    }

    const compliance = await this.compliance.screenTransfer({
      sender: { legalName: input.senderLegalName, country: input.senderCountry },
      recipient: { legalName: input.recipient.displayName, country: input.recipient.country }
    });
    await this.db.query(
      `INSERT INTO linqasend_compliance_checks(transfer_id, subject_type, provider, decision, reasons)
       VALUES ($1,'TRANSFER',$2,$3,$4)`,
      [id, "screening", compliance.decision, JSON.stringify(compliance.reasons)]
    );

    if (compliance.decision === "BLOCK") {
      await this.setStatus(id, "COMPLIANCE_SCREENING", "DECLINED", { failureCode: "COMPLIANCE_BLOCK" });
      return { status: "DECLINED", reason: "COMPLIANCE_BLOCK" };
    }
    if (compliance.decision === "REVIEW" || kyc.decision === "REVIEW") {
      await this.setStatus(id, "COMPLIANCE_SCREENING", "MANUAL_REVIEW");
      return { status: "MANUAL_REVIEW", reason: compliance.decision === "REVIEW" ? "COMPLIANCE_REVIEW" : "KYC_REVIEW" };
    }

    await this.setStatus(id, "COMPLIANCE_SCREENING", "RISK_REVIEW");
    const risk = this.risk.evaluate({
      amountMinor: BigInt(input.quote.sendAmountMinor),
      isNewRecipient: input.authContext.isNewRecipient,
      isNewPaymentMethod: input.authContext.isNewPaymentMethod,
      accountAgeDays: input.authContext.accountAgeDays,
      recentPasswordReset: input.authContext.recentPasswordReset,
      recentSimChange: input.authContext.recentSimChange,
      velocity24hMinor: input.authContext.velocity24hMinor,
      deviceTrusted: input.authContext.deviceTrusted,
      countryRiskScore: input.authContext.countryRiskScore
    });
    await this.db.query(
      `INSERT INTO linqasend_risk_assessments(transfer_id, combined_score, risk_level, decision, reasons)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, risk.score, risk.decision, risk.decision, JSON.stringify(risk.reasons)]
    );

    if (risk.decision === "DECLINE" || risk.decision === "FREEZE_ACCOUNT") {
      await this.setStatus(id, "RISK_REVIEW", "DECLINED", { failureCode: "RISK_DECLINE" });
      return { status: "DECLINED", reason: "RISK_DECLINE" };
    }
    if (risk.decision === "REVIEW" || risk.decision === "TEMPORARY_HOLD") {
      await this.setStatus(id, "RISK_REVIEW", "MANUAL_REVIEW");
      return { status: "MANUAL_REVIEW", reason: "RISK_REVIEW" };
    }
    if (risk.decision === "ALLOW_STEP_UP" && !input.authContext.stepUpVerified) {
      await this.setStatus(id, "RISK_REVIEW", "REQUIRES_ACTION");
      return { status: "REQUIRES_ACTION", action: "STEP_UP_AUTH" };
    }

    await this.setStatus(id, "RISK_REVIEW", "FUNDING_AUTHORIZATION");
    if (!input.paymentMethodId) {
      await this.setStatus(id, "FUNDING_AUTHORIZATION", "DECLINED", { failureCode: "NO_PAYMENT_METHOD" });
      return { status: "DECLINED", reason: "NO_PAYMENT_METHOD" };
    }

    // Capability approval and create-time readiness are not enough: before ANY money-provider
    // call, require the persisted responsibility snapshot, re-resolve it now, and authorize only
    // the provider the approved contracts name. The worker and retries come through advance() too.
    try {
      await this.responsibility.authorize(id, input.quote.provider);
    } catch (error) {
      const code = error instanceof ResponsibilityError ? error.code : "REAL_MONEY_NOT_READY";
      await this.setStatus(id, "FUNDING_AUTHORIZATION", "DECLINED", {
        failureCode: code,
        failureMessage: error instanceof Error ? error.message.slice(0, 500) : code
      });
      return { status: "DECLINED", reason: code };
    }

    if (!input.paymentMethodRef) throw new Error("VERIFIED_PROVIDER_PAYMENT_REFERENCE_REQUIRED");
    const fundingReference = this.tokenVault ? await this.tokenVault.resolve(input.paymentMethodRef,{actorId:"linqasend-execution",purpose:"FUNDING_AUTHORIZATION",expectedOwnerUserId:input.userId}) : input.paymentMethodRef;
    const fundingKey = `${input.idempotencyKey}:funding`;
    // The card is charged the send amount plus the sender fee (0 for standard delivery); the recipient still gets the full send amount.
    const fundingAmountMinor = BigInt(input.quote.sendAmountMinor) + BigInt(input.quote.senderFeeMinor ?? "0");
    const fundingOperation = await this.operations.register({transferId:id,providerId:input.quote.provider,operationType:"FUNDING_AUTHORIZATION",idempotencyKey:fundingKey,payload:{transferId:publicId,amountMinor:fundingAmountMinor.toString(),currency:input.quote.sendCurrency}});
    await this.operations.submitted(fundingOperation.id);
    let authorization;
    try { authorization = await this.providers.funding.authorizeFunding({
      transferId: publicId,
      providerPaymentMethodRef: fundingReference,
      amountMinor: fundingAmountMinor,
      currency: input.quote.sendCurrency,
      idempotencyKey: fundingKey
    }); await this.operations.succeeded(fundingOperation.id,authorization.providerRef,authorization); }
    catch (error) { await this.operations.unknown(fundingOperation.id,error); throw error; }
    await this.recordAttempt(id, "FUNDING_AUTHORIZATION", authorization.status, {
      provider: input.quote.provider,
      providerRef: authorization.providerRef,
      errorCode: authorization.declineCode
    });

    if (authorization.status === "REQUIRES_ACTION") {
      await this.setStatus(id, "FUNDING_AUTHORIZATION", "REQUIRES_ACTION");
      return { status: "REQUIRES_ACTION", action: "PAYMENT_ACTION" };
    }
    if (authorization.status === "DECLINED") {
      await this.setStatus(id, "FUNDING_AUTHORIZATION", "DECLINED", { failureCode: authorization.declineCode });
      return { status: "DECLINED", reason: authorization.declineCode };
    }

    // No real payment provider is configured in this environment, so
    // execution never legitimately reaches this point today — see
    // SafeDefaultFundingProvider, which always declines funding above.
    // The remaining steps are implemented so a real provider integration
    // only has to be plugged into `FundingProvider`/`PayoutProvider`
    // (server/src/integrations/linqasend/provider.contracts.ts), not
    // rebuilt.
    await this.setStatus(id, "FUNDING_AUTHORIZATION", "FUNDS_AUTHORIZED");
    await this.setStatus(id, "FUNDS_AUTHORIZED", "TRANSFER_SUBMITTED");
    await this.setStatus(id, "TRANSFER_SUBMITTED", "PROCESSING");

    const payoutReference = input.recipient.providerRecipientRef.startsWith("vault:")
      ? (this.tokenVault ? await this.tokenVault.resolve(input.recipient.providerRecipientRef,{actorId:"linqasend-execution",purpose:"PAYOUT_SUBMISSION",expectedOwnerUserId:input.userId}) : (() => { throw new Error("PROVIDER_TOKEN_VAULT_REQUIRED"); })())
      : input.recipient.providerRecipientRef;
    const payoutKey = `${input.idempotencyKey}:payout`;
    const payoutOperation = await this.operations.register({transferId:id,providerId:input.quote.provider,operationType:"PAYOUT",idempotencyKey:payoutKey,payload:{transferId:publicId,amountMinor:input.quote.receiveAmountMinor,currency:input.quote.receiveCurrency}});
    await this.operations.submitted(payoutOperation.id);
    let payout;
    try { payout = await this.providers.payout.createPayout({
      transferId: publicId,
      recipientProviderRef: payoutReference,
      amountMinor: BigInt(input.quote.receiveAmountMinor),
      currency: input.quote.receiveCurrency,
      idempotencyKey: payoutKey
    }); await this.operations.succeeded(payoutOperation.id,payout.providerRef,payout); }
    catch (error) { await this.operations.unknown(payoutOperation.id,error); throw error; }
    await this.recordAttempt(id, "PAYOUT", payout.status, { provider: input.quote.provider, providerRef: payout.providerRef });

    await this.setStatus(id, "PROCESSING", "PAYOUT_SUBMITTED");
    if (payout.status === "COMPLETED") {
      await this.completion.complete({ transferId: id, providerReference: payout.providerRef, source: "EXECUTION_WORKER" });
      return { status: "COMPLETED" };
    }

    await this.setStatus(id, "PAYOUT_SUBMITTED", "PAYOUT_PROCESSING");
    return { status: "PAYOUT_PROCESSING" };
  }
}
