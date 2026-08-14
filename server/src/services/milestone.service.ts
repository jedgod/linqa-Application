import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";

export class MilestoneService {
  constructor(private readonly db: Database) {}

  async enabled(featureKey: string, userId: string, clientVersion?: string) {
    const result = await this.db.query(
      `SELECT f.*, m.status AS milestone_status
       FROM milestone_feature_flags f
       JOIN product_milestones m ON m.code=f.milestone_code
       WHERE f.key=$1`,
      [featureKey]
    );

    const row = result.rows[0];
    if (!row || !row.enabled || row.milestone_status !== "ACTIVE") return false;

    if (
      row.minimum_client_version &&
      clientVersion &&
      compareVersions(clientVersion,row.minimum_client_version) < 0
    ) return false;

    const bucket = createHash("sha256")
      .update(`${featureKey}:${userId}`)
      .digest()
      .readUInt32BE(0) % 100;

    return bucket < row.rollout_percentage;
  }
}

function compareVersions(a:string,b:string) {
  const x=a.split(".").map(Number), y=b.split(".").map(Number);
  for (let i=0;i<Math.max(x.length,y.length);i++) {
    const l=x[i]??0, r=y[i]??0;
    if (l!==r) return l<r?-1:1;
  }
  return 0;
}
