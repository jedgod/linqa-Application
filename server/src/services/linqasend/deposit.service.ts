import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "../../db/pool.js";
import type { PayoutProvider, PayoutResult } from "../../integrations/linqasend/provider.contracts.js";
import { canonical } from "../../security/biometrics/canonical.js";
import { easternDate } from "./business-days.js";
import { depositOptionsFor, type DepositOption } from "./deposit-options.js";
import { WalletLedgerService } from "./wallet-ledger.service.js";

export class DepositError extends Error { constructor(readonly code: string) { super(code); } }
type Input = { userId: string; publicId: string; option: DepositOption; paymentMethodId: string; now?: Date };
export type WithdrawalPolicy = {
  authorizePayout(row: any): Promise<void>;
  resolveDestination(reference: string, owner: string): Promise<string>;
};
const denyPolicy: WithdrawalPolicy = {
  async authorizePayout() { throw new DepositError("withdrawal_provider_not_ready"); },
  async resolveDestination() { throw new DepositError("withdrawal_provider_not_ready"); }
};

/** Receipt-backed withdrawals. The request row is also a durable, leased outbox operation. */
export class DepositService {
  private readonly ledger: WalletLedgerService;
  constructor(private readonly db: Database, private readonly payout: PayoutProvider, private readonly policy: WithdrawalPolicy = denyPolicy) {
    this.ledger = new WalletLedgerService(db);
  }
  private async receivedTransfer(userId: string, publicId: string, client: Pick<PoolClient,"query"> = this.db) {
    const { rows } = await client.query(`SELECT t.id,t.public_id,t.status,t.receive_amount_minor,t.receive_currency,q.sender_fee_minor,t.provider,
      w.id AS wallet_id,w.status AS wallet_status,w.subledger_enabled
      FROM linqasend_transfers t JOIN linqasend_recipients r ON r.id=t.recipient_id JOIN linqasend_quotes q ON q.id=t.quote_id
      LEFT JOIN linqasend_wallet_journals j ON j.external_ref='receipt:'||t.id::text
      LEFT JOIN linqasend_wallet_postings wp ON wp.journal_id=j.id AND wp.bucket='AVAILABLE'
      LEFT JOIN linqasend_wallet_accounts_v2 w ON w.id=wp.wallet_id AND w.user_id=$2
      WHERE t.public_id=$1 AND r.linqa_user_id=$2`,[publicId,userId]);
    const t=rows[0];
    if (!t) throw new DepositError("transfer_not_found");
    if (t.status!=="COMPLETED") throw new DepositError("transfer_not_completed");
    if (!t.wallet_id || !t.subledger_enabled || t.wallet_status!=="ACTIVE") throw new DepositError("wallet_receipt_not_verified");
    return t;
  }
  async options(userId: string, publicId: string, now=new Date()) {
    const t=await this.receivedTransfer(userId,publicId);
    const e=(await this.db.query(`SELECT option,status FROM linqasend_deposit_requests WHERE transfer_id=$1`,[t.id])).rows[0];
    return {transferId:t.public_id,amountMinor:BigInt(t.receive_amount_minor),currency:t.receive_currency.trim(),senderPaidInstantFee:BigInt(t.sender_fee_minor??0)>0n,
      options:depositOptionsFor({amountMinor:BigInt(t.receive_amount_minor),currency:t.receive_currency.trim(),senderPaidInstantFeeMinor:BigInt(t.sender_fee_minor??0),now}),
      chosen:e&&!['FAILED','CANCELED'].includes(e.status)?{option:e.option,status:e.status}:null};
  }
  /** This server-owned snapshot is bound to the hardware biometric grant. */
  async preview(input: Input, client: Pick<PoolClient,"query"> = this.db) {
    const t=await this.receivedTransfer(input.userId,input.publicId,client);
    const d=(await client.query(`SELECT provider_payment_method_ref,provider FROM linqasend_payment_methods
      WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND verification_status='VERIFIED' AND type::text IN ('BANK_ACCOUNT','DEBIT_CARD')`,[input.paymentMethodId,input.userId])).rows[0];
    if(!d || d.provider!==t.provider) throw new DepositError("deposit_destination_required");
    const plan=depositOptionsFor({amountMinor:BigInt(t.receive_amount_minor),currency:t.receive_currency.trim(),senderPaidInstantFeeMinor:BigInt(t.sender_fee_minor??0),now:input.now??new Date()});
    if(input.option==="instant"&&!plan.instant.available) throw new DepositError("instant_deposit_unavailable");
    const fee=input.option==="instant"?plan.instant.receiverFeeMinor:0n;
    const snapshot={userId:input.userId,transferId:t.id,publicId:t.public_id,walletId:t.wallet_id,paymentMethodId:input.paymentMethodId,option:input.option,
      amountMinor:String(t.receive_amount_minor),netMinor:(BigInt(t.receive_amount_minor)-fee).toString(),feeMinor:fee.toString(),currency:t.receive_currency.trim(),
      releaseOn:input.option==="standard"?plan.standard.availableOn:null,senderFeeRefundMinor:input.option==="standard"?plan.standard.senderFeeRefundMinor.toString():"0",
      destinationHash:createHash("sha256").update(d.provider_payment_method_ref).digest("hex"),providerId:t.provider};
    return {snapshot,destinationRef:d.provider_payment_method_ref as string};
  }
  async request(input: Input, authorize: (client: PoolClient, snapshot: unknown) => Promise<void>) {
    const client=await this.db.connect();
    let s:Awaited<ReturnType<DepositService["preview"]>>["snapshot"]; let id:string;
    try {
      await client.query("BEGIN");
      const preview=await this.preview(input,client);s=preview.snapshot;
      await authorize(client,s);
      await client.query(`SELECT id FROM linqasend_transfers WHERE id=$1 FOR UPDATE`,[s.transferId]);
      const old=(await client.query(`SELECT * FROM linqasend_deposit_requests WHERE transfer_id=$1 FOR UPDATE`,[s.transferId])).rows[0];
      if(old&&(!['FAILED','CANCELED'].includes(old.status)||!old.wallet_id)) throw new DepositError("deposit_already_chosen");
      id=randomUUID();
      await this.ledger.reserve(client,s.walletId,input.userId,BigInt(s.amountMinor),s.currency,id);
      await client.query(`INSERT INTO linqasend_deposit_requests(id,transfer_id,receiver_user_id,payment_method_id,option,amount_minor,currency,receiver_fee_minor,net_deposit_minor,
        sender_fee_refund_minor,sender_fee_refund_status,status,release_on,wallet_id,provider_id,destination_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SCHEDULED',$12,$13,$14,$15)
        ON CONFLICT(transfer_id) DO UPDATE SET id=excluded.id,payment_method_id=excluded.payment_method_id,option=excluded.option,
        receiver_fee_minor=excluded.receiver_fee_minor,net_deposit_minor=excluded.net_deposit_minor,sender_fee_refund_minor=excluded.sender_fee_refund_minor,
        sender_fee_refund_status=excluded.sender_fee_refund_status,status='SCHEDULED',release_on=excluded.release_on,provider_ref=NULL,failure_code=NULL,
        destination_ref=excluded.destination_ref,provider_id=excluded.provider_id,lease_token=NULL,lease_expires_at=NULL,attempt_count=0,submission_started_at=NULL,available_at=now(),updated_at=now()`,
        [id,s.transferId,input.userId,s.paymentMethodId,s.option,s.amountMinor,s.currency,s.feeMinor,s.netMinor,s.senderFeeRefundMinor,
        BigInt(s.senderFeeRefundMinor)>0n?"PENDING_REFUND":"NONE",s.releaseOn,s.walletId,s.providerId,preview.destinationRef]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    return {depositId:id,option:s.option,status:"SCHEDULED" as const,netDepositMinor:BigInt(s.netMinor),receiverFeeMinor:BigInt(s.feeMinor),releaseOn:s.releaseOn,senderFeeRefundMinor:BigInt(s.senderFeeRefundMinor)};
  }
  /** Expired leases recover with lookup under the original identity; transport ambiguity keeps the hold. */
  async releaseDue(now=new Date()):Promise<number> {
    const client=await this.db.connect();let row:any;const token=randomUUID();
    try {
      await client.query("BEGIN");
      row=(await client.query(`SELECT d.*,t.public_id FROM linqasend_deposit_requests d JOIN linqasend_transfers t ON t.id=d.transfer_id
        WHERE d.wallet_id IS NOT NULL AND d.available_at<=now() AND
        ((d.status='SCHEDULED' AND (d.release_on IS NULL OR d.release_on<=$1::date)) OR
        (d.status IN ('PROCESSING','RECONCILING') AND (d.lease_expires_at IS NULL OR d.lease_expires_at<now())))
        ORDER BY d.available_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,[easternDate(now)])).rows[0];
      if(!row){await client.query("COMMIT");return 0;}
      await client.query(`UPDATE linqasend_deposit_requests SET status='PROCESSING',lease_token=$2,lease_expires_at=now()+interval '60 seconds',attempt_count=attempt_count+1,updated_at=now() WHERE id=$1`,[row.id,token]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    let submitted=!!row.submission_started_at;
    try {
      let outcome:PayoutResult|null;
      if(submitted) {
        // Read-only reconciliation must continue even when a kill switch or account restriction blocks new payouts.
        outcome=row.provider_ref?await this.payout.lookup(row.provider_ref):await this.payout.lookupByIdempotencyKey?.(`deposit:${row.id}`)??null;
      }else{
        await this.policy.authorizePayout(row);
        const dest=await this.policy.resolveDestination(row.destination_ref,row.receiver_user_id);
        const dispatch=await this.db.query(`UPDATE linqasend_deposit_requests SET submission_started_at=now() WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() RETURNING id`,[row.id,token]);
        if(!dispatch.rows[0])return 1;
        submitted=true;
        outcome=await this.payout.createPayout({transferId:row.public_id,recipientProviderRef:dest,amountMinor:BigInt(row.net_deposit_minor),currency:row.currency.trim(),idempotencyKey:`deposit:${row.id}`});
      }
      await this.applyOutcome(row,token,outcome);
    }catch{
      await this.db.query(`UPDATE linqasend_deposit_requests SET status=$3,failure_code=$4,available_at=now()+interval '1 minute',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`,[row.id,token,submitted?"RECONCILING":"SCHEDULED",submitted?"PROVIDER_OUTCOME_UNKNOWN":"WITHDRAWAL_POLICY_PENDING"]);
    }
    return 1;
  }
  private async applyOutcome(row:any,token:string,outcome:PayoutResult|null) {
    if(outcome&&!outcome.providerRef)throw new Error('WITHDRAWAL_PROVIDER_REFERENCE_REQUIRED');
    const client=await this.db.connect();
    try {
      await client.query("BEGIN");
      const locked=(await client.query(`SELECT * FROM linqasend_deposit_requests WHERE id=$1 AND lease_token=$2 FOR UPDATE`,[row.id,token])).rows[0];
      if(!locked){await client.query("COMMIT");return;}
      const terminal=outcome?.status==="COMPLETED"||outcome?.status==="FAILED";
      if(terminal)await this.ledger.finish(client,locked,outcome!.status==="COMPLETED",outcome!.providerRef);
      await client.query(`UPDATE linqasend_deposit_requests SET status=$2,provider_ref=coalesce($3,provider_ref),failure_code=$4,
        available_at=now()+interval '1 minute',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
        [row.id,terminal?outcome!.status:"RECONCILING",outcome?.providerRef??null,outcome?.status==="FAILED"?"PAYOUT_REJECTED":null]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async cancel(userId:string,id:string) {
    const client=await this.db.connect();
    try{
      await client.query('BEGIN');
      const row=(await client.query(`SELECT * FROM linqasend_deposit_requests WHERE id=$1 AND receiver_user_id=$2 FOR UPDATE`,[id,userId])).rows[0];
      if(!row||!row.wallet_id)throw new DepositError('withdrawal_not_found');
      if(row.status==='CANCELED'){await client.query('COMMIT');return {status:'CANCELED'};}
      if(row.submission_started_at||!['SCHEDULED','PROCESSING'].includes(row.status))throw new DepositError('withdrawal_already_dispatched');
      await this.ledger.finish(client,row,false);
      await client.query(`UPDATE linqasend_deposit_requests SET status='CANCELED',failure_code='CUSTOMER_CANCELED',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[id]);
      await client.query('COMMIT');return {status:'CANCELED'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
export function assertWithdrawalSnapshot(expected: unknown, actual: unknown) {
  if(canonical(expected)!==canonical(actual))throw new DepositError("withdrawal_details_changed");
}
