import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";

export class PaymentIntentService {
  constructor(private readonly db: Database) {}
  async resolve(userId: string, quoteId: string) {
    // Resolve a previously accepted transfer even if its quote has since expired.
    const transfer = await this.db.query(`SELECT public_id,status,idempotency_key FROM linqasend_transfers WHERE user_id=$1 AND quote_id=$2 ORDER BY created_at LIMIT 1`, [userId, quoteId]);
    if (transfer.rows[0]) return { idempotencyKey: transfer.rows[0].idempotency_key, transferId: transfer.rows[0].public_id, status: transfer.rows[0].status };
    const quote = await this.db.query(`SELECT id FROM linqasend_quotes WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND expires_at>now()`, [quoteId, userId]);
    if (!quote.rows[0]) throw new Error("QUOTE_EXPIRED_OR_NOT_OWNED");
    await this.db.query(`INSERT INTO linqasend_payment_intents(user_id,quote_id,idempotency_key) VALUES($1,$2,$3) ON CONFLICT(user_id,quote_id) DO NOTHING`, [userId, quoteId, randomUUID()]);
    const result = await this.db.query(`SELECT idempotency_key FROM linqasend_payment_intents WHERE user_id=$1 AND quote_id=$2`, [userId, quoteId]);
    if (!result.rows[0]) throw new Error("PAYMENT_INTENT_UNAVAILABLE");
    return { idempotencyKey: result.rows[0].idempotency_key as string };
  }
}
