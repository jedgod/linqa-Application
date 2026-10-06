import type { Database } from "../../db/pool.js";
import {
  RegulatedEntityResolverV7,
  type FinancialResponsibility,
  type RegulatedEntityResolution
} from "./regulatory-v7.js";

export class ResponsibilityError extends Error {
  constructor(
    readonly code:
      | "REGULATED_RESPONSIBILITY_SNAPSHOT_REQUIRED"
      | "REAL_MONEY_NOT_READY"
      | "REGULATED_PROVIDER_NOT_AUTHORIZED"
      | "RESPONSIBILITY_MAP_CHANGED",
    detail?: string
  ) {
    super(detail ? `${code}:${detail}` : code);
  }
}

const FUNDING_RESPONSIBILITIES: FinancialResponsibility[] = ["CARD_ACQUIRING", "BANK_DEBIT"];
const PAYOUT_RESPONSIBILITIES: FinancialResponsibility[] = ["LOCAL_BANK_PAYOUT", "MOBILE_MONEY_PAYOUT", "CARD_PUSH_PAYOUT"];

/**
 * The single gate in front of every money-provider call.
 *
 * It never trusts the create-time decision or the request. It requires the
 * persisted responsibility snapshot, re-resolves responsibility NOW (a partner
 * may have gone down or a contract expired since the transfer was created),
 * refuses if the governing map or its version changed, and authorizes a
 * provider only if the approved contracts name exactly that adapter.
 */
export class ResponsibilityExecutionGuard {
  private readonly resolver: RegulatedEntityResolverV7;

  constructor(private readonly db: Database) {
    this.resolver = new RegulatedEntityResolverV7(db);
  }

  async authorize(
    transferId: string,
    providerId: string,
    at = new Date()
  ): Promise<{ snapshotId: string; snapshotSha256: string; resolution: RegulatedEntityResolution }> {
    const result = await this.db.query(
      `SELECT t.responsibility_snapshot_id, t.transfer_class, t.funding_mode, t.receive_mode, t.source_country, t.destination_country,
              t.send_currency, t.receive_currency, s.responsibility_map_id, s.policy_version, s.complete, s.snapshot_hash
       FROM linqasend_transfers t
       LEFT JOIN linqasend_responsibility_snapshots_v7 s ON s.id = t.responsibility_snapshot_id
       WHERE t.id = $1`,
      [transferId]
    );
    const row = result.rows[0];
    if (!row?.responsibility_snapshot_id || !row.snapshot_hash) throw new ResponsibilityError("REGULATED_RESPONSIBILITY_SNAPSHOT_REQUIRED");
    if (!row.complete) throw new ResponsibilityError("REAL_MONEY_NOT_READY", "SNAPSHOT_INCOMPLETE");
    if (!row.transfer_class || !row.funding_mode || !row.receive_mode || !row.source_country || !row.destination_country) {
      throw new ResponsibilityError("REGULATED_RESPONSIBILITY_SNAPSHOT_REQUIRED", "TRANSFER_CLASSIFICATION_MISSING");
    }

    const resolution = await this.resolver.resolve({
      sourceCountry: row.source_country,
      destinationCountry: row.destination_country,
      transferClass: row.transfer_class,
      sourceCurrency: row.send_currency,
      destinationCurrency: row.receive_currency,
      fundingMode: row.funding_mode,
      receiveMode: row.receive_mode,
      at
    });
    if (!resolution.complete) {
      throw new ResponsibilityError("REAL_MONEY_NOT_READY", resolution.blockedReasons[0] ?? resolution.missingResponsibilities[0] ?? "RESPONSIBILITY_INCOMPLETE");
    }
    if (resolution.responsibilityMapId !== row.responsibility_map_id || resolution.policyVersion !== Number(row.policy_version)) {
      throw new ResponsibilityError("RESPONSIBILITY_MAP_CHANGED", `${row.responsibility_map_id}@${row.policy_version}->${resolution.responsibilityMapId}@${resolution.policyVersion}`);
    }

    const bound = resolution.authorities.filter(
      (a) => FUNDING_RESPONSIBILITIES.includes(a.responsibility) || PAYOUT_RESPONSIBILITIES.includes(a.responsibility)
    );
    if (bound.length === 0) throw new ResponsibilityError("REGULATED_PROVIDER_NOT_AUTHORIZED", "NO_FUNDING_OR_PAYOUT_AUTHORITY");
    for (const authority of bound) {
      if (!authority.providerAdapterKey || authority.providerAdapterKey !== providerId) {
        throw new ResponsibilityError("REGULATED_PROVIDER_NOT_AUTHORIZED", `${authority.responsibility}:${authority.providerAdapterKey ?? "NO_ADAPTER_KEY"}`);
      }
    }
    return { snapshotId: row.responsibility_snapshot_id, snapshotSha256: row.snapshot_hash, resolution };
  }
}
