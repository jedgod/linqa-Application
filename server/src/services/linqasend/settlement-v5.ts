import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import { LedgerService } from "./ledger.service.js";

export interface CurrencyPosition { currency: string; safeguardingAssetMinor: bigint; customerLiabilityMinor: bigint; providerReceivableMinor: bigint; providerPayableMinor: bigint; fxLiquidityMinor: bigint; reserveMinor: bigint; suspenseDebitMinor: bigint; suspenseCreditMinor: bigint; availableLiquidityMinor: bigint }
export interface SafeguardingCheckResult { currency: string; customerLiabilityMinor: bigint; safeguardingAssetMinor: bigint; deltaMinor: bigint; status: "BALANCED" | "ASSET_SHORTFALL" | "ASSET_EXCESS" | "REVIEW" }

function toBigInt(value: unknown): bigint { return BigInt(String(value ?? 0)); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

export class SettlementTreasuryV5Service {
  private readonly ledger: LedgerService;
  constructor(private readonly db: Database) { this.ledger = new LedgerService(db); }

  async checkSafeguarding(currency: string): Promise<SafeguardingCheckResult> {
    const [assetResult, liabilityResult] = await Promise.all([
      this.db.query(`SELECT coalesce(sum(last_reported_balance_minor),0)::bigint AS total FROM linqasend_settlement_accounts_v5 WHERE account_type='SAFEGUARDING' AND currency=$1 AND active=true`, [currency.toUpperCase()]),
      this.db.query(`SELECT coalesce(sum(amount_minor),0)::bigint AS total FROM linqasend_customer_liabilities_v8 WHERE currency=$1`, [currency.toUpperCase()])
    ]);
    const safeguardingAssetMinor = toBigInt(assetResult.rows[0]?.total);
    const customerLiabilityMinor = toBigInt(liabilityResult.rows[0]?.total);
    const deltaMinor = safeguardingAssetMinor - customerLiabilityMinor;
    return { currency: currency.toUpperCase(), customerLiabilityMinor, safeguardingAssetMinor, deltaMinor, status: deltaMinor === 0n ? "BALANCED" : deltaMinor < 0n ? "ASSET_SHORTFALL" : "ASSET_EXCESS" };
  }

  async calculatePosition(currency: string, positionDate = new Date()): Promise<CurrencyPosition> {
    const c = currency.toUpperCase();
    const [accounts, liabilities, external, suspense] = await Promise.all([
      this.db.query(`SELECT account_type,coalesce(sum(last_reported_balance_minor),0)::bigint AS total FROM linqasend_settlement_accounts_v5 WHERE currency=$1 AND active=true GROUP BY account_type`, [c]),
      this.db.query(`SELECT coalesce(sum(amount_minor),0)::bigint AS total FROM linqasend_customer_liabilities_v8 WHERE currency=$1`, [c]),
      this.db.query(`SELECT coalesce(sum(CASE WHEN direction='RECEIVABLE' THEN amount_minor ELSE 0 END),0)::bigint AS receivable,coalesce(sum(CASE WHEN direction='PAYABLE' THEN amount_minor ELSE 0 END),0)::bigint AS payable FROM linqasend_external_settlement_records_v5 WHERE currency=$1`, [c]),
      this.db.query(`SELECT coalesce(sum(debit_minor),0)::bigint AS debit,coalesce(sum(credit_minor),0)::bigint AS credit FROM linqasend_suspense_items_v5 WHERE currency=$1 AND status='OPEN'`, [c])
    ]);
    const byType = new Map(accounts.rows.map((r) => [r.account_type, toBigInt(r.total)]));
    const customerLiabilityMinor = toBigInt(liabilities.rows[0]?.total);
    const safeguardingAssetMinor = byType.get("SAFEGUARDING") ?? 0n;
    const fxLiquidityMinor = byType.get("FX_LIQUIDITY") ?? 0n;
    const reserveMinor = byType.get("RESERVE") ?? 0n;
    const providerReceivableMinor = toBigInt(external.rows[0]?.receivable);
    const providerPayableMinor = toBigInt(external.rows[0]?.payable);
    const suspenseDebitMinor = toBigInt(suspense.rows[0]?.debit);
    const suspenseCreditMinor = toBigInt(suspense.rows[0]?.credit);
    const availableLiquidityMinor = safeguardingAssetMinor + fxLiquidityMinor + providerReceivableMinor - providerPayableMinor - customerLiabilityMinor;
    const position = { currency: c, safeguardingAssetMinor, customerLiabilityMinor, providerReceivableMinor, providerPayableMinor, fxLiquidityMinor, reserveMinor, suspenseDebitMinor, suspenseCreditMinor, availableLiquidityMinor };
    await this.db.query(`INSERT INTO linqasend_treasury_positions_v5(position_date,currency,safeguarding_asset_minor,customer_liability_minor,provider_receivable_minor,provider_payable_minor,fx_liquidity_minor,reserve_minor,suspense_debit_minor,suspense_credit_minor,available_liquidity_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(position_date,currency) DO UPDATE SET safeguarding_asset_minor=excluded.safeguarding_asset_minor,customer_liability_minor=excluded.customer_liability_minor,provider_receivable_minor=excluded.provider_receivable_minor,provider_payable_minor=excluded.provider_payable_minor,fx_liquidity_minor=excluded.fx_liquidity_minor,reserve_minor=excluded.reserve_minor,suspense_debit_minor=excluded.suspense_debit_minor,suspense_credit_minor=excluded.suspense_credit_minor,available_liquidity_minor=excluded.available_liquidity_minor,calculated_at=now()`, [positionDate.toISOString().slice(0, 10), c, ...Object.values(position).slice(1).map(String)]);
    return position;
  }

  async assertLiquidity(currency: string, availableMinor: bigint): Promise<{ state: string; allowNewTransfers: boolean; requiredTopUpMinor?: string; excessMinor?: string }> {
    const { rows } = await this.db.query(`SELECT * FROM linqasend_liquidity_policies_v5 WHERE currency=$1 AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY version DESC LIMIT 1`, [currency.toUpperCase()]);
    const policy = rows[0];
    if (!policy) return { state: "NO_POLICY", allowNewTransfers: false };
    const min = toBigInt(policy.min_available_minor), target = toBigInt(policy.target_available_minor), max = toBigInt(policy.max_available_minor);
    if (availableMinor < min) return { state: "CRITICAL", allowNewTransfers: false, requiredTopUpMinor: (target - availableMinor).toString() };
    if (availableMinor < target) return { state: "WARNING", allowNewTransfers: true, requiredTopUpMinor: (target - availableMinor).toString() };
    if (availableMinor > max) return { state: "EXCESS", allowNewTransfers: true, excessMinor: (availableMinor - target).toString() };
    return { state: "HEALTHY", allowNewTransfers: true };
  }

  async createSettlementInstruction(args: { transferId: string; providerId: string; settlementAccountId: string; amountMinor: bigint; currency: string; direction: "PAYABLE" | "RECEIVABLE"; idempotencyKey: string }): Promise<{ id: string; status: string }> {
    if (args.idempotencyKey.length < 16) throw new Error("VALID_IDEMPOTENCY_KEY_REQUIRED");
    const id = randomUUID();
    const { rows } = await this.db.query(`INSERT INTO linqasend_settlement_instructions_v5(id,transfer_id,provider_id,settlement_account_id,amount_minor,currency,direction,status,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,'CREATED',$8) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,status`, [id, args.transferId, args.providerId, args.settlementAccountId, args.amountMinor.toString(), args.currency.toUpperCase(), args.direction, args.idempotencyKey]);
    return { id: rows[0].id, status: rows[0].status };
  }

  async addInstructionToBatch(args: { instructionId: string; providerId: string; currency: string; settlementDate: Date; batchType: string }): Promise<{ batchId: string; status: string }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const batch = await client.query(`INSERT INTO linqasend_settlement_batches_v5(provider_id,currency,settlement_date,batch_type,status) VALUES($1,$2,$3,$4,'OPEN') ON CONFLICT(provider_id,currency,settlement_date,batch_type) DO UPDATE SET provider_id=excluded.provider_id RETURNING id,status`, [args.providerId, args.currency.toUpperCase(), args.settlementDate.toISOString().slice(0, 10), args.batchType]);
      if (batch.rows[0].status !== "OPEN") throw new Error("SETTLEMENT_BATCH_NOT_OPEN");
      const instruction = await client.query(`SELECT id,amount_minor,provider_id,currency,status,batch_id FROM linqasend_settlement_instructions_v5 WHERE id=$1 FOR UPDATE`, [args.instructionId]);
      const row = instruction.rows[0];
      if (!row) throw new Error("SETTLEMENT_INSTRUCTION_NOT_FOUND");
      if (row.provider_id !== args.providerId || row.currency !== args.currency.toUpperCase()) throw new Error("SETTLEMENT_BATCH_DIMENSION_MISMATCH");
      if (row.batch_id && row.batch_id !== batch.rows[0].id) throw new Error("SETTLEMENT_INSTRUCTION_ALREADY_BATCHED");
      if (!['CREATED','READY'].includes(row.status)) throw new Error("SETTLEMENT_INSTRUCTION_NOT_BATCHABLE");
      await client.query(`INSERT INTO linqasend_settlement_batch_items_v5(batch_id,instruction_id,amount_minor) VALUES($1,$2,$3) ON CONFLICT(instruction_id) DO NOTHING`, [batch.rows[0].id, row.id, row.amount_minor]);
      await client.query(`UPDATE linqasend_settlement_instructions_v5 SET batch_id=$2,status='BATCHED',updated_at=now() WHERE id=$1`, [row.id, batch.rows[0].id]);
      await client.query(`UPDATE linqasend_settlement_batches_v5 b SET instruction_count=x.count,total_minor=x.total FROM (SELECT batch_id,count(*)::int AS count,sum(amount_minor)::bigint AS total FROM linqasend_settlement_batch_items_v5 WHERE batch_id=$1 GROUP BY batch_id) x WHERE b.id=x.batch_id`, [batch.rows[0].id]);
      await client.query("COMMIT");
      return { batchId: batch.rows[0].id, status: "OPEN" };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async sealBatch(batchId: string): Promise<{ id: string; checksum: string; instructionCount: number; totalMinor: string }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const batchResult = await client.query(`SELECT * FROM linqasend_settlement_batches_v5 WHERE id=$1 FOR UPDATE`, [batchId]);
      const batch = batchResult.rows[0];
      if (!batch || batch.status !== "OPEN") throw new Error("SETTLEMENT_BATCH_NOT_OPEN");
      const items = await client.query(`SELECT instruction_id,amount_minor FROM linqasend_settlement_batch_items_v5 WHERE batch_id=$1 ORDER BY instruction_id`, [batchId]);
      if (!items.rows.length) throw new Error("EMPTY_SETTLEMENT_BATCH");
      const checksum = createHash("sha256").update(stableJson({ providerId: batch.provider_id, currency: batch.currency, settlementDate: batch.settlement_date, batchType: batch.batch_type, items: items.rows.map((r) => ({ instructionId: r.instruction_id, amountMinor: String(r.amount_minor) })) })).digest("hex");
      const total = items.rows.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
      await client.query(`UPDATE linqasend_settlement_batches_v5 SET status='SEALED',instruction_count=$2,total_minor=$3,checksum=$4,sealed_at=now() WHERE id=$1`, [batchId, items.rows.length, total.toString(), checksum]);
      await client.query("COMMIT");
      return { id: batchId, checksum, instructionCount: items.rows.length, totalMinor: total.toString() };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async markBatchSubmitted(batchId: string, providerReference: string): Promise<void> {
    const result = await this.db.query(`UPDATE linqasend_settlement_batches_v5 SET status='SUBMITTED',provider_reference=$2,submitted_at=now() WHERE id=$1 AND status='SEALED' AND checksum IS NOT NULL`, [batchId, providerReference]);
    if (!result.rowCount) throw new Error("ONLY_SEALED_BATCH_CAN_BE_SUBMITTED");
    await this.db.query(`UPDATE linqasend_settlement_instructions_v5 SET status='SUBMITTED',updated_at=now() WHERE batch_id=$1 AND status='BATCHED'`, [batchId]);
  }

  async importExternalRecords(args: { sourceType: "BANK" | "PROVIDER"; sourceId: string; fileHash: string; records: Array<{ externalId: string; providerReference?: string; amountMinor: bigint; currency: string; direction: "PAYABLE" | "RECEIVABLE"; occurredAt: Date; raw: Record<string, unknown> }> }): Promise<{ imported: number; duplicates: number }> {
    let imported = 0, duplicates = 0;
    for (const record of args.records) {
      const result = await this.db.query(`INSERT INTO linqasend_external_settlement_records_v5(source_type,source_id,external_id,provider_reference,amount_minor,currency,direction,occurred_at,raw_record,file_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(source_type,source_id,external_id) DO NOTHING`, [args.sourceType, args.sourceId, record.externalId, record.providerReference ?? null, record.amountMinor.toString(), record.currency.toUpperCase(), record.direction, record.occurredAt, JSON.stringify(record.raw), args.fileHash]);
      if (result.rowCount) imported++; else duplicates++;
    }
    return { imported, duplicates };
  }

  async reconcile(sourceType: "BANK" | "PROVIDER", sourceId: string, from: Date, to: Date): Promise<{ runId: string; matched: number; breaks: number }> {
    const runId = randomUUID();
    await this.db.query(`INSERT INTO linqasend_reconciliation_runs_v5(id,source_type,source_id,period_start,period_end,status) VALUES($1,$2,$3,$4,$5,'RUNNING')`, [runId, sourceType, sourceId, from, to]);
    const { rows } = await this.db.query(`SELECT e.id,e.provider_reference,e.amount_minor,e.currency,i.id AS instruction_id,i.amount_minor AS internal_amount,i.currency AS internal_currency FROM linqasend_external_settlement_records_v5 e LEFT JOIN linqasend_settlement_instructions_v5 i ON i.provider_reference=e.provider_reference WHERE e.source_type=$1 AND e.source_id=$2 AND e.occurred_at >= $3 AND e.occurred_at < $4`, [sourceType, sourceId, from, to]);
    let matched = 0, breaks = 0;
    for (const row of rows) {
      const status = !row.instruction_id ? "MISSING_INTERNAL" : String(row.amount_minor) !== String(row.internal_amount) || row.currency !== row.internal_currency ? "MISMATCH" : "MATCHED";
      await this.db.query(`INSERT INTO linqasend_reconciliation_matches_v5(run_id,external_record_id,settlement_instruction_id,status,internal_amount_minor,external_amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7)`, [runId, row.id, row.instruction_id, status, row.internal_amount ?? null, row.amount_minor, row.currency]);
      if (status === "MATCHED") matched++; else {
        breaks++;
        const delta = row.internal_amount === null ? toBigInt(row.amount_minor) : toBigInt(row.amount_minor) - toBigInt(row.internal_amount);
        const severity = delta < -100_000n || delta > 100_000n ? "CRITICAL" : delta !== 0n ? "HIGH" : "MEDIUM";
        await this.db.query(`INSERT INTO linqasend_reconciliation_breaks_v5(run_id,break_type,severity,status,external_record_id,settlement_instruction_id,delta_minor,currency,details) VALUES($1,$2,$3,'OPEN',$4,$5,$6,$7,$8)`, [runId, status, severity, row.id, row.instruction_id, delta.toString(), row.currency, JSON.stringify({ providerReference: row.provider_reference })]);
      }
    }
    await this.db.query(`UPDATE linqasend_reconciliation_runs_v5 SET status=$2,matched_count=$3,break_count=$4,completed_at=now() WHERE id=$1`, [runId, breaks ? "COMPLETED_WITH_BREAKS" : "COMPLETED", matched, breaks]);
    return { runId, matched, breaks };
  }

  async openSuspenseForBreak(breakId: string): Promise<{ id: string; status: string }> {
    const { rows } = await this.db.query(`SELECT id,currency,delta_minor,status FROM linqasend_reconciliation_breaks_v5 WHERE id=$1`, [breakId]);
    const item = rows[0];
    if (!item || item.status !== "OPEN") throw new Error("OPEN_RECONCILIATION_BREAK_REQUIRED");
    const delta = BigInt(item.delta_minor ?? 0);
    const result = await this.db.query(`INSERT INTO linqasend_suspense_items_v5(reconciliation_break_id,currency,debit_minor,credit_minor,status) VALUES($1,$2,$3,$4,'OPEN') RETURNING id,status`, [breakId, item.currency, delta < 0n ? (-delta).toString() : "0", delta > 0n ? delta.toString() : "0"]);
    return result.rows[0];
  }

  async resolveBreak(args: { breakId: string; actorId: string; resolutionCode: string; notes: string }): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE linqasend_reconciliation_breaks_v5 SET status='RESOLVED',assigned_to=$2,resolution_code=$3,resolution_notes=$4,resolved_at=now() WHERE id=$1 AND status='OPEN'`, [args.breakId, args.actorId, args.resolutionCode, args.notes]);
      if (!result.rowCount) throw new Error("OPEN_RECONCILIATION_BREAK_REQUIRED");
      await client.query(`UPDATE linqasend_suspense_items_v5 SET status='RESOLVED',resolved_at=now() WHERE reconciliation_break_id=$1 AND status='OPEN'`, [args.breakId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async requestMoneyAdjustment(args: { transferId: string; type: "FULL_REFUND" | "REVERSAL"; requestedBy: string; reasonCode: string; notes?: string }): Promise<{ actionId: string; adjustmentId: string; status: string }> {
    const transfer = await this.db.query(`SELECT id,send_amount_minor,send_currency,status FROM linqasend_transfers WHERE id=$1`, [args.transferId]);
    const row = transfer.rows[0];
    if (!row || row.status !== "COMPLETED") throw new Error("COMPLETED_TRANSFER_REQUIRED");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const action = await client.query(`INSERT INTO linqasend_privileged_money_actions_v4(action_type,transfer_id,requested_by,status,reason_code,notes) VALUES($1,$2,$3,'REQUESTED',$4,$5) RETURNING id`, [args.type, args.transferId, args.requestedBy, args.reasonCode, args.notes ?? null]);
      const adjustment = await client.query(`INSERT INTO linqasend_money_adjustments_v5(transfer_id,action_id,adjustment_type,amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,'REQUESTED') RETURNING id`, [args.transferId, action.rows[0].id, args.type, row.send_amount_minor, row.send_currency]);
      await client.query("COMMIT");
      return { actionId: action.rows[0].id, adjustmentId: adjustment.rows[0].id, status: "REQUESTED" };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async approveAndExecuteMoneyAdjustment(actionId: string, approvedBy: string): Promise<{ adjustmentId: string; ledgerExternalRef: string }> {
    // The legacy refund path cannot debit an authoritative wallet or claw back an external withdrawal.
    // Route these to operations until a provider-confirmed wallet refund workflow is available.
    const walletReceipt=await this.db.query(`SELECT 1 FROM linqasend_privileged_money_actions_v4 a JOIN linqasend_transfers t ON t.id=a.transfer_id
      JOIN linqasend_recipients r ON r.id=t.recipient_id WHERE a.id=$1 AND (r.recipient_type='LINQA_USER'
      OR EXISTS(SELECT 1 FROM linqasend_wallet_journals j WHERE j.transfer_id=t.id AND j.kind='RECEIPT'))`,[actionId]);
    if(walletReceipt.rows.length)throw new Error("WALLET_REFUND_REQUIRES_RECONCILED_CUSTODY_WORKFLOW");
    const action = await this.db.query(`UPDATE linqasend_privileged_money_actions_v4 SET approved_by=$2,status='APPROVED',approved_at=now() WHERE id=$1 AND status='REQUESTED' AND requested_by<>$2 RETURNING id,transfer_id,action_type`, [actionId, approvedBy]);
    if (!action.rows[0]) throw new Error("MONEY_ACTION_NOT_APPROVABLE_OR_SELF_APPROVAL");
    const adjustment = await this.db.query(`SELECT * FROM linqasend_money_adjustments_v5 WHERE action_id=$1 AND status='REQUESTED'`, [actionId]);
    const row = adjustment.rows[0];
    if (!row) throw new Error("MONEY_ADJUSTMENT_NOT_EXECUTABLE");
    const ledgerExternalRef = `adjustment:${row.id}`;
    await this.ledger.reverseTransaction({ originalExternalRef: `transfer:${row.transfer_id}:completion`, reversalExternalRef: ledgerExternalRef, description: `LinqaSend ${String(row.adjustment_type).toLowerCase()} reversing journal` });
    const executed = await this.db.query(`UPDATE linqasend_money_adjustments_v5 SET status='EXECUTED',ledger_external_ref=$2,executed_at=now() WHERE id=$1 AND status='REQUESTED' RETURNING id`, [row.id, ledgerExternalRef]);
    if (!executed.rows[0]) throw new Error("MONEY_ADJUSTMENT_EXECUTION_RACE");
    await this.db.query(`UPDATE linqasend_privileged_money_actions_v4 SET status='EXECUTED',executed_at=now() WHERE id=$1 AND status='APPROVED'`, [actionId]);
    return { adjustmentId: row.id, ledgerExternalRef };
  }

  async requestTreasuryAction(args: { actionType: string; currency: string; amountMinor: bigint; requestedBy: string; reasonCode: string; metadata?: Record<string, unknown> }): Promise<{ id: string; status: string }> {
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_treasury_actions_v5(id,action_type,currency,amount_minor,requested_by,status,reason_code,metadata) VALUES($1,$2,$3,$4,$5,'REQUESTED',$6,$7)`, [id, args.actionType, args.currency.toUpperCase(), args.amountMinor.toString(), args.requestedBy, args.reasonCode, JSON.stringify(args.metadata ?? {})]);
    return { id, status: "REQUESTED" };
  }

  async approveTreasuryAction(id: string, approvedBy: string): Promise<void> {
    const result = await this.db.query(`UPDATE linqasend_treasury_actions_v5 SET approved_by=$2,status='APPROVED',approved_at=now() WHERE id=$1 AND status='REQUESTED' AND requested_by<>$2`, [id, approvedBy]);
    if (!result.rowCount) throw new Error("TREASURY_ACTION_NOT_APPROVABLE_OR_SELF_APPROVAL");
  }

  async runEndOfDay(date: Date, currencies: string[]): Promise<{ id: string; status: "GREEN" | "AMBER" | "RED"; evidenceHash: string }> {
    const checks = [];
    for (const currency of currencies) {
      const safeguarding = await this.checkSafeguarding(currency);
      const position = await this.calculatePosition(currency, date);
      checks.push({ safeguarding: { ...safeguarding, customerLiabilityMinor: safeguarding.customerLiabilityMinor.toString(), safeguardingAssetMinor: safeguarding.safeguardingAssetMinor.toString(), deltaMinor: safeguarding.deltaMinor.toString() }, availableLiquidityMinor: position.availableLiquidityMinor.toString() });
    }
    const openBreaks = await this.db.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE severity='CRITICAL')::int AS critical FROM linqasend_reconciliation_breaks_v5 WHERE status='OPEN'`);
    const red = checks.some((c) => c.safeguarding.status === "ASSET_SHORTFALL") || Number(openBreaks.rows[0]?.critical ?? 0) > 0;
    const amber = !red && (checks.some((c) => c.safeguarding.status !== "BALANCED") || Number(openBreaks.rows[0]?.total ?? 0) > 0);
    const status = red ? "RED" : amber ? "AMBER" : "GREEN";
    const evidence = { date: date.toISOString().slice(0, 10), checks, openBreaks: openBreaks.rows[0], status };
    const evidenceHash = createHash("sha256").update(stableJson(evidence)).digest("hex");
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_eod_controls_v5(id,control_date,status,checks,evidence_hash,completed_at) VALUES($1,$2,$3,$4,$5,now())`, [id, evidence.date, status, JSON.stringify(evidence), evidenceHash]);
    return { id, status, evidenceHash };
  }

  async dashboard(): Promise<Record<string, unknown>> {
    const [positions, breaks, batches, eod] = await Promise.all([
      this.db.query(`SELECT * FROM linqasend_treasury_positions_v5 ORDER BY position_date DESC,currency LIMIT 100`),
      this.db.query(`SELECT * FROM linqasend_reconciliation_breaks_v5 WHERE status='OPEN' ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,created_at`),
      this.db.query(`SELECT * FROM linqasend_settlement_batches_v5 ORDER BY created_at DESC LIMIT 50`),
      this.db.query(`SELECT * FROM linqasend_eod_controls_v5 ORDER BY control_date DESC LIMIT 1`)
    ]);
    return { positions: positions.rows, openBreaks: breaks.rows, recentBatches: batches.rows, latestEod: eod.rows[0] ?? null };
  }
}
