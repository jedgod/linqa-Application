import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import type { PayoutProvider } from "../../integrations/linqasend/provider.contracts.js";
import { easternDate } from "./business-days.js";
import { depositOptionsFor, type DepositOption } from "./deposit-options.js";

export class DepositError extends Error {
  constructor(readonly code:
    | "transfer_not_found" | "transfer_not_completed" | "deposit_already_chosen" | "deposit_destination_required"
    | "instant_deposit_unavailable" | "deposit_provider_failed") { super(code); }
}

/** Where a receiver may send received money: a verified bank account or debit card they own. */
const DEPOSIT_DESTINATION_TYPES = ["BANK_ACCOUNT", "DEBIT_CARD"];

type ReceivedTransfer = { id: string; publicId: string; status: string; amountMinor: bigint; currency: string; senderFeeMinor: bigint };

/**
 * Receiver-side deposit: money arrives in the receiver's Linqa wallet regardless of the delivery option, then the receiver
 * decides how to move it to a bank or card on file. The sender's optional instant fee only changes who pays for "instant".
 */
export class DepositService {
  constructor(private readonly db: Database, private readonly payout: PayoutProvider) {}

  private async receivedTransfer(userId: string, publicId: string): Promise<ReceivedTransfer> {
    const { rows } = await this.db.query(
      `SELECT t.id,t.public_id,t.status,t.receive_amount_minor,t.receive_currency,q.sender_fee_minor
       FROM linqasend_transfers t
       JOIN linqasend_recipients r ON r.id=t.recipient_id
       JOIN linqasend_quotes q ON q.id=t.quote_id
       WHERE t.public_id=$1 AND r.linqa_user_id=$2`,
      [publicId, userId]
    );
    const row = rows[0];
    if (!row) throw new DepositError("transfer_not_found");
    if (row.status !== "COMPLETED") throw new DepositError("transfer_not_completed");
    return { id: row.id, publicId: row.public_id, status: row.status, amountMinor: BigInt(row.receive_amount_minor), currency: String(row.receive_currency).trim(), senderFeeMinor: BigInt(row.sender_fee_minor ?? 0) };
  }

  async options(userId: string, publicId: string, now = new Date()) {
    const transfer = await this.receivedTransfer(userId, publicId);
    const existing = await this.db.query(`SELECT option,status,release_on,net_deposit_minor FROM linqasend_deposit_requests WHERE transfer_id=$1`, [transfer.id]);
    const chosen = existing.rows[0] && existing.rows[0].status !== "FAILED" ? { option: existing.rows[0].option as DepositOption, status: existing.rows[0].status as string } : null;
    return {
      transferId: transfer.publicId,
      amountMinor: transfer.amountMinor,
      currency: transfer.currency,
      senderPaidInstantFee: transfer.senderFeeMinor > 0n,
      options: depositOptionsFor({ amountMinor: transfer.amountMinor, currency: transfer.currency, senderPaidInstantFeeMinor: transfer.senderFeeMinor, now }),
      chosen
    };
  }

  async request(input: { userId: string; publicId: string; option: DepositOption; paymentMethodId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const transfer = await this.receivedTransfer(input.userId, input.publicId);
    const destination = await this.db.query(
      `SELECT provider_payment_method_ref FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND verification_status='VERIFIED' AND type::text = ANY($3::text[])`,
      [input.paymentMethodId, input.userId, DEPOSIT_DESTINATION_TYPES]
    );
    if (!destination.rows[0]) throw new DepositError("deposit_destination_required");

    const plan = depositOptionsFor({ amountMinor: transfer.amountMinor, currency: transfer.currency, senderPaidInstantFeeMinor: transfer.senderFeeMinor, now });
    if (input.option === "instant" && !plan.instant.available) throw new DepositError("instant_deposit_unavailable");
    const instant = input.option === "instant";
    const fee = instant ? plan.instant.receiverFeeMinor : 0n;
    const net = instant ? plan.instant.netDepositMinor : plan.standard.netDepositMinor;
    const refund = instant ? 0n : plan.standard.senderFeeRefundMinor;

    const id = randomUUID();
    // One decision per transfer; a FAILED attempt may be replaced, anything else is final.
    const inserted = await this.db.query(
      `INSERT INTO linqasend_deposit_requests(id,transfer_id,receiver_user_id,payment_method_id,option,amount_minor,currency,receiver_fee_minor,net_deposit_minor,sender_fee_refund_minor,sender_fee_refund_status,status,release_on)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(transfer_id) DO UPDATE SET id=excluded.id,payment_method_id=excluded.payment_method_id,option=excluded.option,receiver_fee_minor=excluded.receiver_fee_minor,
         net_deposit_minor=excluded.net_deposit_minor,sender_fee_refund_minor=excluded.sender_fee_refund_minor,sender_fee_refund_status=excluded.sender_fee_refund_status,
         status=excluded.status,release_on=excluded.release_on,failure_code=NULL,provider_ref=NULL,updated_at=now()
       WHERE linqasend_deposit_requests.status='FAILED' AND linqasend_deposit_requests.receiver_user_id=excluded.receiver_user_id
       RETURNING id`,
      [id, transfer.id, input.userId, input.paymentMethodId, input.option, transfer.amountMinor.toString(), transfer.currency, fee.toString(), net.toString(), refund.toString(),
       refund > 0n ? "PENDING_REFUND" : "NONE", instant ? "PROCESSING" : "SCHEDULED", instant ? null : plan.standard.availableOn]
    );
    if (!inserted.rows[0]) throw new DepositError("deposit_already_chosen");

    if (!instant) return { depositId: id, option: input.option, status: "SCHEDULED" as const, netDepositMinor: net, receiverFeeMinor: 0n, releaseOn: plan.standard.availableOn, senderFeeRefundMinor: refund };

    const result = await this.pay(id, transfer.publicId, destination.rows[0].provider_payment_method_ref as string, net, transfer.currency);
    return { depositId: id, option: input.option, status: result, netDepositMinor: net, receiverFeeMinor: fee, releaseOn: null, senderFeeRefundMinor: 0n };
  }

  /** Releases every scheduled deposit whose business-day wait is over. Safe to run repeatedly. */
  async releaseDue(now = new Date()): Promise<number> {
    const today = easternDate(now);
    const claimed = await this.db.query(
      `UPDATE linqasend_deposit_requests d SET status='PROCESSING',updated_at=now()
       FROM linqasend_transfers t, linqasend_payment_methods m
       WHERE d.status='SCHEDULED' AND d.release_on <= $1::date AND t.id=d.transfer_id AND m.id=d.payment_method_id
       RETURNING d.id,t.public_id,m.provider_payment_method_ref,d.net_deposit_minor,d.currency`,
      [today]
    );
    for (const row of claimed.rows) await this.pay(row.id, row.public_id, row.provider_payment_method_ref, BigInt(row.net_deposit_minor), String(row.currency).trim());
    return claimed.rows.length;
  }

  private async pay(depositId: string, publicId: string, destinationRef: string, netMinor: bigint, currency: string): Promise<"COMPLETED" | "PROCESSING" | "FAILED"> {
    try {
      const outcome = await this.payout.createPayout({ transferId: publicId, recipientProviderRef: destinationRef, amountMinor: netMinor, currency, idempotencyKey: `deposit:${depositId}` });
      const status = outcome.status === "FAILED" ? "FAILED" : outcome.status === "COMPLETED" ? "COMPLETED" : "PROCESSING";
      await this.db.query(`UPDATE linqasend_deposit_requests SET status=$2,provider_ref=$3,failure_code=$4,updated_at=now() WHERE id=$1`, [depositId, status, outcome.providerRef, status === "FAILED" ? "PAYOUT_FAILED" : null]);
      if (status === "FAILED") throw new DepositError("deposit_provider_failed");
      return status;
    } catch (error) {
      if (error instanceof DepositError) throw error;
      await this.db.query(`UPDATE linqasend_deposit_requests SET status='FAILED',failure_code='PAYOUT_ERROR',updated_at=now() WHERE id=$1`, [depositId]);
      throw new DepositError("deposit_provider_failed");
    }
  }
}
