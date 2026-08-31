import type { Database } from "../db/pool.js";
import type { ProviderHealthState } from "./home.types.js";

export interface ProviderHealthRow {
  providerName: string;
  state: ProviderHealthState;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  circuitOpenUntil: string | null;
  movingLatencyMs: number | null;
  successRate: number;
  updatedAt: string;
}

export class ProviderHealthRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<ProviderHealthRow[]> {
    const result = await this.db.query(
      `SELECT provider_name AS "providerName",
              state,
              consecutive_failures AS "consecutiveFailures",
              last_success_at AS "lastSuccessAt",
              last_failure_at AS "lastFailureAt",
              circuit_open_until AS "circuitOpenUntil",
              moving_latency_ms::float8 AS "movingLatencyMs",
              success_rate::float8 AS "successRate",
              updated_at AS "updatedAt"
       FROM home_news_provider_health
       ORDER BY provider_name`
    );
    return result.rows as ProviderHealthRow[];
  }

  /**
   * Operational override used by the admin surface: a provider that is
   * misbehaving in a way the circuit breaker can't see (bad data rather than
   * errors) can be taken out of rotation without a deploy.
   */
  async setState(providerName: string, state: ProviderHealthState): Promise<void> {
    await this.db.query(
      `INSERT INTO home_news_provider_health(provider_name,state)
       VALUES($1,$2)
       ON CONFLICT(provider_name) DO UPDATE SET
         state=EXCLUDED.state,
         circuit_open_until=CASE WHEN EXCLUDED.state='HEALTHY' THEN NULL
           ELSE home_news_provider_health.circuit_open_until END,
         consecutive_failures=CASE WHEN EXCLUDED.state='HEALTHY' THEN 0
           ELSE home_news_provider_health.consecutive_failures END,
         updated_at=now()`,
      [providerName, state]
    );
  }
}
