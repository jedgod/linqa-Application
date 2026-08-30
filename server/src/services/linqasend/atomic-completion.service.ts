import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";

/** Posts the completion journal, status, outbox, request linkage and audit atomically. */
export class AtomicCompletionService {
  constructor(private readonly db: Database) {}

  async complete(input: { transferId: string; providerReference?: string; source: "EXECUTION_WORKER" | "WEBHOOK_WORKER" }): Promise<{ completed: boolean; journalId: string }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(`SELECT * FROM linqasend_transfers WHERE id=$1 FOR UPDATE`, [input.transferId]);
      const transfer = locked.rows[0];
      if (!transfer) throw new Error("TRANSFER_NOT_FOUND");
      if (transfer.status === "COMPLETED") {
        if (!transfer.completion_journal_id) throw new Error("COMPLETED_TRANSFER_MISSING_JOURNAL");
        await client.query("COMMIT");
        return { completed: false, journalId: transfer.completion_journal_id as string };
      }
      if (!['PAYOUT_SUBMITTED','PAYOUT_PROCESSING'].includes(transfer.status)) throw new Error(`COMPLETION_FROM_INVALID_STATE:${transfer.status}`);

      const externalRef = `transfer:${input.transferId}:completion`;
      const existing = await client.query(`SELECT id FROM linqasend_ledger_transactions WHERE external_ref=$1`, [externalRef]);
      let journalId = existing.rows[0]?.id as string | undefined;
      if (!journalId) {
        journalId = randomUUID();
        await client.query(`INSERT INTO linqasend_ledger_transactions(id,external_ref,transfer_id,description,currency) VALUES($1,$2,$3,'LinqaSend completed transfer accounting',$4)`, [journalId,externalRef,input.transferId,transfer.send_currency]);
        const accounts = await client.query(`SELECT code,id FROM linqasend_ledger_accounts WHERE code=ANY($1::text[])`, [['CLEARING_CARD','TRANSFER_PAYABLE']]);
        const byCode = new Map(accounts.rows.map((row) => [row.code as string,row.id as string]));
        if (!byCode.get('CLEARING_CARD') || !byCode.get('TRANSFER_PAYABLE')) throw new Error("COMPLETION_LEDGER_ACCOUNTS_MISSING");
        await client.query(`INSERT INTO linqasend_ledger_entries(ledger_transaction_id,account_id,side,amount_minor,currency) VALUES($1,$2,'DEBIT',$3,$4),($1,$5,'CREDIT',$3,$4)`, [journalId,byCode.get('CLEARING_CARD'),String(transfer.send_amount_minor),transfer.send_currency,byCode.get('TRANSFER_PAYABLE')]);
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('linqasend-ledger-integrity-v4'))`);
        const previous = await client.query(`SELECT journal_hash FROM linqasend_ledger_integrity_v4 ORDER BY computed_at DESC,journal_id DESC LIMIT 1`);
        const previousHash = previous.rows[0]?.journal_hash ?? null;
        const journalHash = createHash('sha256').update(JSON.stringify({version:'LINQASEND_LEDGER_V4',journalId,externalRef,transferId:input.transferId,currency:transfer.send_currency,amountMinor:String(transfer.send_amount_minor),previousHash})).digest('hex');
        await client.query(`INSERT INTO linqasend_ledger_integrity_v4(journal_id,previous_hash,journal_hash,posting_count) VALUES($1,$2,$3,2)`, [journalId,previousHash,journalHash]);
      }
      await client.query(`UPDATE linqasend_transfers SET status='COMPLETED',completion_journal_id=$2,provider_payout_ref=coalesce($3,provider_payout_ref),completed_at=now(),updated_at=now() WHERE id=$1`, [input.transferId,journalId,input.providerReference ?? null]);
      if (typeof transfer.purpose_code === 'string' && transfer.purpose_code.startsWith('REQUEST:')) {
        await client.query(`UPDATE linqasend_money_requests_v1 SET status='PAID',paid_transfer_id=$2,updated_at=now() WHERE id=$1 AND payer_user_id=$3 AND status='AWAITING_PAYMENT'`, [transfer.purpose_code.slice(8),input.transferId,transfer.user_id]);
      }
      await client.query(`INSERT INTO linqasend_notification_outbox_v1(user_id,notification_type,payload,dedupe_key) VALUES($1,'TRANSFER_STATUS_CHANGED',$2,$3) ON CONFLICT(dedupe_key) DO NOTHING`, [transfer.user_id,JSON.stringify({transferId:transfer.public_id,status:'COMPLETED'}),`transfer:${input.transferId}:COMPLETED`]);
      await client.query(`INSERT INTO linqasend_completion_audit(transfer_id,journal_id,prior_status,source,evidence) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [input.transferId,journalId,transfer.status,input.source,JSON.stringify({providerReference:input.providerReference ?? null})]);
      await client.query("COMMIT");
      return { completed: true, journalId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
