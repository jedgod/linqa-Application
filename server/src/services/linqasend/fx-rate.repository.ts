import type { Database } from "../../db/pool.js";

/**
 * Real exchange rates come from admin-published snapshots in
 * `linqasend_fx_rate_snapshots`, not a live market-data API (none is
 * configured here) and not a fabricated constant. A quote request fails
 * closed if no fresh snapshot exists for the requested currency pair,
 * exactly like every other unconfigured-provider path in this server.
 */
export class FxRateRepository {
  constructor(private readonly db: Database) {}

  async latest(baseCurrency: string, quoteCurrency: string) {
    const { rows } = await this.db.query(
      `SELECT market_rate, provider_rate, provider, source_timestamp, valid_until
       FROM linqasend_fx_rate_snapshots
       WHERE base_currency = $1 AND quote_currency = $2 AND valid_until > now()
       ORDER BY received_at DESC
       LIMIT 1`,
      [baseCurrency, quoteCurrency]
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`No live FX rate published for ${baseCurrency}->${quoteCurrency}`);
    }
    return {
      marketRate: String(row.market_rate),
      executionRate: String(row.provider_rate),
      provider: row.provider as string,
      validUntil: new Date(row.valid_until)
    };
  }

  async publish(input: {
    provider: string;
    baseCurrency: string;
    quoteCurrency: string;
    marketRate: string;
    providerRate: string;
    sourceTimestamp: Date;
    validUntil: Date;
  }) {
    await this.db.query(
      `INSERT INTO linqasend_fx_rate_snapshots(
         provider, base_currency, quote_currency, market_rate, provider_rate, source_timestamp, valid_until
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.provider,
        input.baseCurrency,
        input.quoteCurrency,
        input.marketRate,
        input.providerRate,
        input.sourceTimestamp,
        input.validUntil
      ]
    );
  }
}
