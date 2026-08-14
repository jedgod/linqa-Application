import type { Database } from "../../db/pool.js";

type LedgerEntryInput = { accountCode: string; side: "DEBIT" | "CREDIT"; amountMinor: bigint };

/**
 * Real double-entry bookkeeping: every transaction must balance
 * (sum(debits) === sum(credits)) before it's posted, and posted entries are
 * immutable — corrections post a new reversing transaction rather than
 * mutating history (`linqasend_ledger_entries` has no UPDATE path here).
 * `externalRef` is unique, so retrying the same logical posting (e.g. a
 * retried webhook) is naturally idempotent via ON CONFLICT DO NOTHING.
 */
export class LedgerService {
  constructor(private readonly db: Database) {}

  async postBalancedTransaction(input: {
    externalRef: string;
    transferId?: string;
    description: string;
    currency: string;
    entries: LedgerEntryInput[];
  }) {
    const debit = input.entries.filter((e) => e.side === "DEBIT").reduce((a, e) => a + e.amountMinor, 0n);
    const credit = input.entries.filter((e) => e.side === "CREDIT").reduce((a, e) => a + e.amountMinor, 0n);
    if (debit !== credit) throw new Error("UNBALANCED_LEDGER_TRANSACTION");

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(`SELECT id FROM linqasend_ledger_transactions WHERE external_ref = $1`, [
        input.externalRef
      ]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { posted: false, alreadyPosted: true, debit: debit.toString(), credit: credit.toString() };
      }

      const tx = await client.query(
        `INSERT INTO linqasend_ledger_transactions(external_ref, transfer_id, description, currency)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.externalRef, input.transferId ?? null, input.description, input.currency]
      );
      const transactionId = tx.rows[0].id as string;

      for (const entry of input.entries) {
        const account = await client.query(`SELECT id FROM linqasend_ledger_accounts WHERE code = $1`, [
          entry.accountCode
        ]);
        if (!account.rows[0]) throw new Error(`UNKNOWN_LEDGER_ACCOUNT:${entry.accountCode}`);

        await client.query(
          `INSERT INTO linqasend_ledger_entries(ledger_transaction_id, account_id, side, amount_minor, currency)
           VALUES ($1,$2,$3,$4,$5)`,
          [transactionId, account.rows[0].id, entry.side, entry.amountMinor.toString(), input.currency]
        );
      }

      await client.query("COMMIT");
      return { posted: true, alreadyPosted: false, debit: debit.toString(), credit: credit.toString() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Simplified single-currency accounting for a completed transfer.
   * Production accounting for real multi-currency settlement would also
   * need clearing/payout-liability/FX-revaluation entries per corridor. */
  async postCompletedTransfer(input: {
    transferId: string;
    sendMinor: bigint;
    sendCurrency: string;
    fxRevenueMinor: bigint;
    processorCostMinor: bigint;
  }) {
    const net = input.fxRevenueMinor - input.processorCostMinor;
    const entries: LedgerEntryInput[] = [
      { accountCode: "CLEARING_CARD", side: "DEBIT", amountMinor: input.sendMinor },
      { accountCode: "TRANSFER_PAYABLE", side: "CREDIT", amountMinor: input.sendMinor - net }
    ];
    if (input.fxRevenueMinor > 0n) entries.push({ accountCode: "FX_REVENUE", side: "CREDIT", amountMinor: input.fxRevenueMinor });
    if (input.processorCostMinor > 0n) {
      entries.push({ accountCode: "PROCESSOR_EXPENSE", side: "DEBIT", amountMinor: input.processorCostMinor });
    }

    return this.postBalancedTransaction({
      externalRef: `transfer:${input.transferId}:completion`,
      transferId: input.transferId,
      description: "LinqaSend completed transfer accounting",
      currency: input.sendCurrency,
      entries
    });
  }
}
