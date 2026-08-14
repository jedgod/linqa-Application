import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";

export class FeatureFlagService {
  constructor(private readonly db: Database) {}

  async enabled(key: string, userId: string, appVersion?: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT *
       FROM feature_flags
       WHERE key = $1`,
      [key]
    );
    const flag = result.rows[0];
    if (!flag || !flag.enabled) return false;
    if ((flag.deny_user_ids as string[]).includes(userId)) return false;
    if ((flag.allow_user_ids as string[]).includes(userId)) return true;

    if (
      flag.minimum_app_version &&
      appVersion &&
      compareVersions(appVersion, flag.minimum_app_version) < 0
    ) {
      return false;
    }

    const hash = createHash("sha256").update(`${key}:${userId}`).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    return bucket < flag.rollout_percentage;
  }
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
