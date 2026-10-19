import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import type { FundingProvider, FundingRefundResult } from "../../integrations/linqasend/provider.contracts.js";

type Scope = { fundingProviderRef: string; amountMinor: string; currency: string };

/** Evidence must echo the exact refund we asked for; anything else is never treated as a refund. */
export function validateRefundEvidence(outcome: FundingRefundResult, scope: Scope): FundingRefundResult {
  if (!outcome.providerRef || outcome.fundingProviderRef !== scope.fundingProviderRef || outcome.amountMinor !== scope.amountMinor || outcome.currency !== scope.currency)
    throw new Error("SENDER_FEE_REFUND_EVIDENCE_MISMATCH");
  return outcome;
}

/**
 * Returns the sender's unused instant-delivery fee after the receiver's standard withdrawal completes.
 * A refund is marked REFUNDED only on provider-confirmed evidence. Once a request may have reached the
 * provider it is only ever looked up by its original idempotency key, never submitted again.
 */
export class SenderFeeRefundService {
  constructor(private readonly db: Database, private readonly funding: Pick<FundingProvider, "refundFee" | "lookupRefundByIdempotencyKey">) {}

  async runOnce(): Promise<number> {
    if (!this.funding.refundFee || !this.funding.lookupRefundByIdempotencyKey) throw new Error("SENDER_FEE_REFUND_UNSUPPORTED");
    const token = randomUUID();
    const client = await this.db.connect();
    let row: any;
    try {
      await client.query("BEGIN");
      row = (await client.query(`SELECT d.id,d.sender_fee_refund_minor,d.refund_submission_started_at,t.id AS transfer_id,t.public_id,t.send_currency,t.provider,q.sender_fee_minor
        FROM linqasend_deposit_requests d JOIN linqasend_transfers t ON t.id=d.transfer_id JOIN linqasend_quotes q ON q.id=t.quote_id
        WHERE d.sender_fee_refund_status='PENDING_REFUND' AND d.status='COMPLETED' AND d.refund_available_at<=now()
        AND (d.refund_lease_expires_at IS NULL OR d.refund_lease_expires_at<now())
        ORDER BY d.refund_available_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`)).rows[0];
      if (!row) { await client.query("COMMIT"); return 0; }
      await client.query(`UPDATE linqasend_deposit_requests SET refund_lease_token=$2,refund_lease_expires_at=now()+interval '60 seconds',refund_attempt_count=refund_attempt_count+1,updated_at=now() WHERE id=$1`, [row.id, token]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }

    let submitted = !!row.refund_submission_started_at;
    try {
      const amount = BigInt(row.sender_fee_refund_minor), fee = BigInt(row.sender_fee_minor ?? 0);
      const funding = (await this.db.query(`SELECT provider_id,provider_reference FROM linqasend_provider_operations WHERE transfer_id=$1 AND operation_type='FUNDING_AUTHORIZATION' AND state='SUCCEEDED' AND provider_reference IS NOT NULL ORDER BY created_at LIMIT 1`, [row.transfer_id])).rows[0];
      if (!submitted) {
        if (amount <= 0n || amount > fee) return await this.review(row.id, token, "SENDER_FEE_REFUND_AMOUNT_INVALID");
        if (!funding || funding.provider_id !== row.provider) return await this.review(row.id, token, "SENDER_FEE_FUNDING_REFERENCE_MISSING");
      } else if (!funding) throw new Error("SENDER_FEE_FUNDING_REFERENCE_MISSING");
      const scope: Scope = { fundingProviderRef: funding.provider_reference, amountMinor: amount.toString(), currency: String(row.send_currency).trim() };
      const key = `deposit-fee-refund:${row.id}`;
      let outcome: FundingRefundResult | null;
      if (submitted) outcome = await this.funding.lookupRefundByIdempotencyKey!(key);
      else {
        const started = await this.db.query(`UPDATE linqasend_deposit_requests SET refund_submission_started_at=now() WHERE id=$1 AND refund_lease_token=$2 AND refund_lease_expires_at>now() RETURNING id`, [row.id, token]);
        if (!started.rows[0]) return 1;
        submitted = true;
        outcome = await this.funding.refundFee!({ transferId: row.public_id, fundingProviderRef: scope.fundingProviderRef, amountMinor: amount, currency: scope.currency, idempotencyKey: key, reasonCode: "INSTANT_FEE_NOT_USED" });
      }
      if (!outcome) return await this.retryLater(row.id, token, "SENDER_FEE_REFUND_OUTCOME_UNKNOWN");
      outcome = validateRefundEvidence(outcome, scope);
      if (outcome.status === "REFUNDED")
        await this.db.query(`UPDATE linqasend_deposit_requests SET sender_fee_refund_status='REFUNDED',refund_provider_ref=$3,refunded_at=now(),refund_failure_code=NULL,refund_lease_token=NULL,refund_lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND refund_lease_token=$2`, [row.id, token, outcome.providerRef]);
      else if (outcome.status === "FAILED") await this.review(row.id, token, "SENDER_FEE_REFUND_REJECTED", outcome.providerRef);
      else await this.retryLater(row.id, token, null, outcome.providerRef);
    } catch {
      await this.retryLater(row.id, token, submitted ? "SENDER_FEE_REFUND_OUTCOME_UNKNOWN" : "SENDER_FEE_REFUND_PROVIDER_UNAVAILABLE");
    }
    return 1;
  }

  private async retryLater(id: string, token: string, code: string | null, providerRef: string | null = null): Promise<number> {
    await this.db.query(`UPDATE linqasend_deposit_requests SET refund_failure_code=$3,refund_provider_ref=coalesce($4,refund_provider_ref),refund_available_at=now()+interval '1 minute',refund_lease_token=NULL,refund_lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND refund_lease_token=$2`, [id, token, code, providerRef]);
    return 1;
  }
  /** Terminal for automation: a person must resolve it, and nothing is resubmitted. */
  private async review(id: string, token: string, code: string, providerRef: string | null = null): Promise<number> {
    await this.db.query(`UPDATE linqasend_deposit_requests SET sender_fee_refund_status='REFUND_REVIEW',refund_failure_code=$3,refund_provider_ref=coalesce($4,refund_provider_ref),refund_lease_token=NULL,refund_lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND refund_lease_token=$2`, [id, token, code, providerRef]);
    return 1;
  }
}
