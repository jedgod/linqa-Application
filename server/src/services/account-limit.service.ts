import type { Database } from "../db/pool.js";

export const MAX_ACCOUNTS_PER_INSTALLATION = 3;

export class AccountLimitService {
  constructor(private readonly db: Database) {}

  async countActive(installationId: string) {
    const result = await this.db.query(
      `SELECT count(*)::int AS count
       FROM installation_accounts_v2
       WHERE installation_id=$1
         AND state='ACTIVE'`,
      [installationId]
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async requireCapacity(installationId: string) {
    const count = await this.countActive(installationId);

    if (count >= MAX_ACCOUNTS_PER_INSTALLATION) {
      await this.db.query(
        `INSERT INTO account_limit_events_v2(
           installation_id,event_type,metadata
         ) VALUES($1,'ACCOUNT_LIMIT_REJECTED',$2)`,
        [installationId, { count, max: MAX_ACCOUNTS_PER_INSTALLATION }]
      );

      throw new Error("ACCOUNT_LIMIT_REACHED");
    }
  }

  async nextAvailableSlot(installationId: string) {
    const result = await this.db.query(
      `SELECT account_slot
       FROM installation_accounts_v2
       WHERE installation_id=$1
         AND state='ACTIVE'`,
      [installationId]
    );

    const used = new Set(result.rows.map((row) => Number(row.account_slot)));

    for (let slot = 1; slot <= MAX_ACCOUNTS_PER_INSTALLATION; slot++) {
      if (!used.has(slot)) return slot;
    }

    throw new Error("ACCOUNT_LIMIT_REACHED");
  }
}
