import type { Database } from "../db/pool.js";
import type { GaReleaseGateService } from "./ga-release-gate.service.js";

const ALLOWED_STEPS = [1, 5, 10, 25, 50, 100];

export class GaRolloutService {
  constructor(
    private readonly db: Database,
    private readonly gates: GaReleaseGateService
  ) {}

  async create(input: { version: string; audience: string; requestedBy: string }) {
    const readiness = await this.gates.summary();

    if (!readiness.ready) {
      throw new Error("GA release gates are not satisfied");
    }

    const result = await this.db.query(
      `INSERT INTO ga_rollouts_v2(
         release_version,audience,rollout_percentage,
         state,requested_by
       ) VALUES($1,$2,1,'PLANNED',$3)
       RETURNING *`,
      [input.version, input.audience, input.requestedBy]
    );

    return result.rows[0];
  }

  async promote(input: { rolloutId: string; requestedBy: string; approver: string; nextPercentage: number }) {
    if (input.requestedBy === input.approver) {
      throw new Error("rollout promotion requires independent approver");
    }

    if (!ALLOWED_STEPS.includes(input.nextPercentage)) {
      throw new Error("invalid GA rollout percentage");
    }

    const readiness = await this.gates.summary();
    if (!readiness.ready) {
      throw new Error("GA release gates became blocking");
    }

    const rollout = await this.db.query(`SELECT * FROM ga_rollouts_v2 WHERE id=$1`, [input.rolloutId]);

    const row = rollout.rows[0];
    if (!row) throw new Error("GA rollout not found");

    if (input.nextPercentage <= Number(row.rollout_percentage)) {
      throw new Error("rollout percentage must increase");
    }

    const state = input.nextPercentage === 100 ? "COMPLETED" : "RUNNING";

    const result = await this.db.query(
      `UPDATE ga_rollouts_v2
       SET rollout_percentage=$2,
           state=$3,
           approved_by=$4,
           started_at=COALESCE(started_at,now()),
           completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE completed_at END
       WHERE id=$1
       RETURNING *`,
      [input.rolloutId, input.nextPercentage, state, input.approver]
    );

    return result.rows[0];
  }

  async rollback(rolloutId: string, actor: string) {
    const result = await this.db.query(
      `UPDATE ga_rollouts_v2
       SET state='ROLLED_BACK',
           approved_by=$2,
           completed_at=now()
       WHERE id=$1
         AND state IN ('PLANNED','RUNNING','PAUSED')
       RETURNING id,state,completed_at`,
      [rolloutId, actor]
    );

    if (result.rowCount !== 1) {
      throw new Error("rollout cannot be rolled back");
    }

    return result.rows[0];
  }
}
