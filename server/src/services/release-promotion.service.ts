import type { Database } from "../db/pool.js";

export class ReleasePromotionService {
  constructor(private readonly db: Database) {}

  async request(input: {
    milestoneCode: "1.0" | "2.0" | "3.0";
    featureKey: string;
    releaseChannel:
      | "INTERNAL"
      | "ALPHA"
      | "BETA"
      | "CANARY"
      | "GENERAL_AVAILABILITY";
    rolloutPercentage: number;
    requestedBy: string;
    evidence?: Record<string, unknown>;
  }) {
    const result = await this.db.query(
      `INSERT INTO milestone_promotions (
         milestone_code,
         feature_key,
         release_channel,
         rollout_percentage,
         status,
         requested_by,
         evidence
       ) VALUES ($1,$2,$3,$4,'PENDING',$5,$6)
       RETURNING id, status, created_at`,
      [
        input.milestoneCode,
        input.featureKey,
        input.releaseChannel,
        input.rolloutPercentage,
        input.requestedBy,
        input.evidence ?? {}
      ]
    );

    return result.rows[0];
  }

  async approve(input: {
    promotionId: string;
    approvedBy: string;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const promotion = await client.query(
        `SELECT *
         FROM milestone_promotions
         WHERE id = $1
         FOR UPDATE`,
        [input.promotionId]
      );

      const row = promotion.rows[0];
      if (!row || row.status !== "PENDING") {
        throw new Error("promotion is not pending");
      }

      if (row.requested_by === input.approvedBy) {
        throw new Error("promotion requester cannot approve their own request");
      }

      const failedGates = await client.query(
        `SELECT gate_key
         FROM release_gate_results
         WHERE milestone_code = $1
           AND status NOT IN ('PASS','WAIVED')`,
        [row.milestone_code]
      );

      if (failedGates.rowCount) {
        throw new Error("required release gates have not passed");
      }

      await client.query(
        `UPDATE milestone_promotions
         SET status = 'ACTIVE',
             approved_by = $2,
             activated_at = now()
         WHERE id = $1`,
        [input.promotionId, input.approvedBy]
      );

      await client.query(
        `UPDATE milestone_feature_flags
         SET enabled = TRUE,
             rollout_percentage = $2,
             updated_at = now()
         WHERE key = $1`,
        [row.feature_key, row.rollout_percentage]
      );

      await client.query("COMMIT");

      return {
        active: true,
        featureKey: row.feature_key,
        rolloutPercentage: row.rollout_percentage
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rollback(input: {
    promotionId: string;
    actor: string;
    reason: string;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const promotion = await client.query(
        `SELECT feature_key
         FROM milestone_promotions
         WHERE id = $1
           AND status = 'ACTIVE'
         FOR UPDATE`,
        [input.promotionId]
      );

      const row = promotion.rows[0];
      if (!row) throw new Error("active promotion not found");

      await client.query(
        `UPDATE milestone_promotions
         SET status = 'ROLLED_BACK',
             ended_at = now(),
             evidence = evidence || $2::jsonb
         WHERE id = $1`,
        [
          input.promotionId,
          JSON.stringify({
            rollbackActor: input.actor,
            rollbackReason: input.reason
          })
        ]
      );

      await client.query(
        `UPDATE milestone_feature_flags
         SET enabled = FALSE,
             rollout_percentage = 0,
             updated_at = now()
         WHERE key = $1`,
        [row.feature_key]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
