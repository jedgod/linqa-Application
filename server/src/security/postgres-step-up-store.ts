import type { Database } from "../db/pool.js";
import type { StepUpConsumptionStore } from "./step-up.js";
export class PostgresStepUpConsumptionStore implements StepUpConsumptionStore {
  constructor(private readonly db: Database) {}
  async consumeOnce(jti: string, expiresAtSeconds: number): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO step_up_consumption (jti, expires_at) VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO NOTHING RETURNING jti`,
      [jti, expiresAtSeconds]
    );
    return (result.rowCount ?? 0) === 1;
  }
}
