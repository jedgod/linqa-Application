import type { Database } from "../../db/pool.js";
import type { LinqaSendProviders } from "./provider.contracts.js";

export interface ReconciliationMismatch {
  transferId: string;
  field: "funding_status" | "payout_status";
  ourValue: string;
  providerValue: string;
}

/**
 * Compares this process's belief about in-flight transfers (the
 * `linqasend_transfer_attempts` rows `TransferOrchestratorService` writes)
 * against what the configured funding/payout providers report right now,
 * via the `lookup*` methods added to `FundingProvider`/`PayoutProvider`
 * specifically for this purpose. With the safe-default (unconfigured)
 * providers, `lookup*` always returns `null`, so this reports zero
 * mismatches rather than fabricating drift that was never observed —
 * consistent with every other fail-closed adapter in this codebase.
 */
export async function reconcileInFlightTransfers(
  db: Database,
  providers: LinqaSendProviders
): Promise<{ checked: number; mismatches: ReconciliationMismatch[] }> {
  const inFlight = await db.query(
    `SELECT t.id, t.public_id, t.idempotency_key, t.status,
            (SELECT provider_ref FROM linqasend_transfer_attempts a
              WHERE a.transfer_id = t.id AND a.phase = 'PAYOUT'
              ORDER BY a.created_at DESC LIMIT 1) AS payout_provider_ref
       FROM linqasend_transfers t
      WHERE t.status IN ('FUNDING_AUTHORIZATION', 'FUNDS_AUTHORIZED', 'PROCESSING', 'PAYOUT_SUBMITTED', 'PAYOUT_PROCESSING')`
  );

  const mismatches: ReconciliationMismatch[] = [];

  for (const row of inFlight.rows) {
    const fundingRecord = await providers.funding.lookupByIdempotencyKey(`${row.idempotency_key}:funding`);
    if (fundingRecord && fundingRecord.status === "DECLINED" && row.status !== "DECLINED") {
      mismatches.push({
        transferId: row.public_id,
        field: "funding_status",
        ourValue: row.status,
        providerValue: fundingRecord.status
      });
    }

    if (row.payout_provider_ref) {
      const payoutRecord = await providers.payout.lookup(row.payout_provider_ref);
      if (payoutRecord && payoutRecord.status === "COMPLETED" && row.status !== "COMPLETED") {
        mismatches.push({
          transferId: row.public_id,
          field: "payout_status",
          ourValue: row.status,
          providerValue: payoutRecord.status
        });
      }
    }
  }

  return { checked: inFlight.rows.length, mismatches };
}
