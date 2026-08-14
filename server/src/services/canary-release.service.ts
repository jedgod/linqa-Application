import type { Database } from "../db/pool.js";

export class CanaryReleaseService {
  constructor(private readonly db: Database) {}

  async create(input: {
    releaseVersion: string;
    environment: string;
    createdBy: string;
    rolloutPercentage: number;
    errorBudgetThreshold: number;
  }) {
    if (input.rolloutPercentage < 1 || input.rolloutPercentage > 25) {
      throw new Error("initial canary rollout must be between 1% and 25%");
    }

    const result = await this.db.query(
      `INSERT INTO canary_releases_v2(
         release_version,environment,rollout_percentage,state,
         error_budget_threshold,created_by
       ) VALUES($1,$2,$3,'CREATED',$4,$5)
       RETURNING *`,
      [input.releaseVersion, input.environment, input.rolloutPercentage, input.errorBudgetThreshold, input.createdBy]
    );

    return result.rows[0];
  }

  async evaluate(input: { canaryId: string; observedErrorRate: number; approver: string }) {
    const result = await this.db.query(
      `SELECT *
       FROM canary_releases_v2
       WHERE id=$1`,
      [input.canaryId]
    );

    const row = result.rows[0];
    if (!row) throw new Error("canary not found");

    if (row.created_by === input.approver) {
      throw new Error("requester cannot approve own canary promotion");
    }

    if (input.observedErrorRate > Number(row.error_budget_threshold)) {
      await this.db.query(
        `UPDATE canary_releases_v2
         SET state='ROLLED_BACK',
             approved_by=$2,
             updated_at=now()
         WHERE id=$1`,
        [input.canaryId, input.approver]
      );

      return { action: "ROLLBACK" as const };
    }

    await this.db.query(
      `UPDATE canary_releases_v2
       SET state='PROMOTED',
           rollout_percentage=100,
           approved_by=$2,
           updated_at=now()
       WHERE id=$1`,
      [input.canaryId, input.approver]
    );

    return { action: "PROMOTE" as const };
  }
}
