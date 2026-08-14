import { createHash } from "node:crypto";
import type { Database } from "../../../db/pool.js";

function bucket(userId: string, key: string): number {
  const digest = createHash("sha256").update(`${userId}:${key}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export async function isCountryLinqaRolloutEnabled(
  db: Database,
  input: { key: string; userId: string; countryCode?: string | null; tier?: string | null }
): Promise<boolean> {
  const result = await db.query(`SELECT * FROM countrylinqa_rollouts WHERE key = $1`, [input.key]);
  const row = result.rows[0];
  if (!row || !row.enabled) return false;

  if (input.countryCode && row.country_blocklist?.includes(input.countryCode)) return false;
  if (row.country_allowlist?.length > 0 && !row.country_allowlist.includes(input.countryCode)) return false;
  if (row.tier_allowlist?.length > 0 && !row.tier_allowlist.includes(input.tier)) return false;

  return bucket(input.userId, input.key) < row.percentage;
}
