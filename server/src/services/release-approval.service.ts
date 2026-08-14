import type { Database } from "../db/pool.js";

export class ReleaseApprovalService {
  constructor(private readonly db: Database) {}

  async approve(input: {
    promotionId: string;
    approverSubject: string;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const promotion = await client.query(
        `SELECT *
         FROM milestone_promotions
         WHERE id=$1
         FOR UPDATE`,
        [input.promotionId]
      );

      const row = promotion.rows[0];
      if (!row || row.status !== "PENDING") {
        throw new Error("promotion is not pending");
      }

      if (row.requested_by === input.approverSubject) {
        throw new Error("requester cannot approve own promotion");
      }

      const gates = await client.query(
        `SELECT gate_key,status
         FROM release_gate_results
         WHERE milestone_code=$1`,
        [row.milestone_code]
      );

      if (!gates.rowCount) {
        throw new Error("no release gates recorded");
      }

      const blocking = gates.rows.filter(
        (gate) => !["PASS", "WAIVED"].includes(gate.status)
      );

      if (blocking.length) {
        throw new Error("release gates have not passed");
      }

      await client.query(
        `UPDATE milestone_promotions
         SET status='ACTIVE',
             approved_by=$2,
             activated_at=now()
         WHERE id=$1`,
        [input.promotionId, input.approverSubject]
      );

      await client.query(
        `UPDATE milestone_feature_flags
         SET enabled=TRUE,
             rollout_percentage=$2,
             updated_at=now()
         WHERE key=$1`,
        [row.feature_key, row.rollout_percentage]
      );

      await client.query("COMMIT");
      return { approved: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
