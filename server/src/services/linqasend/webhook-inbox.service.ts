import type { Database } from "../../db/pool.js";
import { AtomicCompletionService } from "./atomic-completion.service.js";
import { assertTransition } from "./transfer-state.js";
import type { WalletCreditEvidence } from "./wallet-ledger.service.js";

type WebhookPayload = { id: string; type: string; transferId?: string; status?: "PAYOUT_PROCESSING" | "COMPLETED" | "FAILED" | "ON_HOLD"; providerReference?: string; failureCode?: string; walletCredit?: WalletCreditEvidence };

/** Durable, leased webhook processing. HTTP ingestion never mutates money state. */
export class WebhookInboxService {
  private readonly completion: AtomicCompletionService;
  constructor(private readonly db: Database) { this.completion = new AtomicCompletionService(db); }

  async claim(workerId: string, leaseSeconds = 60): Promise<{ id: string; providerId: string; payload: WebhookPayload } | null> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`SELECT * FROM linqasend_webhook_inbox WHERE (status='RECEIVED' OR (status='FAILED' AND available_at<=now()) OR (status='PROCESSING' AND lease_expires_at<now())) ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      const row = result.rows[0];
      if (!row) { await client.query("COMMIT"); return null; }
      await client.query(`UPDATE linqasend_webhook_inbox SET status='PROCESSING',leased_by=$2,lease_expires_at=now()+($3::text||' seconds')::interval,attempt_count=attempt_count+1 WHERE id=$1`, [row.id,workerId,leaseSeconds]);
      await client.query("COMMIT");
      return { id: row.id, providerId: row.provider_id, payload: JSON.parse(Buffer.from(row.raw_body).toString("utf8")) as WebhookPayload };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async process(item: { id: string; providerId: string; payload: WebhookPayload }): Promise<void> {
    try {
      const p = item.payload;
      if (p.transferId && p.status) {
        const found = await this.db.query(`SELECT * FROM linqasend_transfers WHERE public_id=$1 AND provider=$2`, [p.transferId,item.providerId]);
        const transfer = found.rows[0];
        if (!transfer) throw new Error("WEBHOOK_TRANSFER_NOT_FOUND_OR_PROVIDER_MISMATCH");
        // A repeated terminal provider event must reach atomic completion's idempotent path.
        if(transfer.status!==p.status)assertTransition(transfer.status,p.status);
        if (p.status === "COMPLETED") await this.completion.complete({transferId:transfer.id,source:"WEBHOOK_WORKER",...(p.providerReference ? {providerReference:p.providerReference} : {}),...(p.walletCredit ? {walletCredit:p.walletCredit} : {})});
        else await this.db.query(`UPDATE linqasend_transfers SET status=$2,provider_payout_ref=coalesce($3,provider_payout_ref),failure_code=coalesce($4,failure_code),updated_at=now() WHERE id=$1`, [transfer.id,p.status,p.providerReference ?? null,p.failureCode ?? null]);
      }
      await this.db.query(`UPDATE linqasend_webhook_inbox SET status='PROCESSED',processed_at=now(),leased_by=NULL,lease_expires_at=NULL WHERE id=$1 AND status='PROCESSING'`, [item.id]);
    } catch (error) {
      await this.db.query(`UPDATE linqasend_webhook_inbox SET status=CASE WHEN attempt_count>=8 THEN 'QUARANTINED' ELSE 'FAILED' END,available_at=now()+least(attempt_count,10)*interval '1 minute',error_code='WEBHOOK_PROCESSING_FAILED',error_message=$2,leased_by=NULL,lease_expires_at=NULL WHERE id=$1`, [item.id,error instanceof Error ? error.message : "unknown"]);
      throw error;
    }
  }
}
