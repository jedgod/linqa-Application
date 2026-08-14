import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";

export class KeyTransparencyV2Service {
  constructor(private readonly db: Database) {}

  async latestProof(userId: string, deviceId: string) {
    const result = await this.db.query(
      `SELECT tree_size,leaf_hash,inclusion_path,signed_tree_head,
              verified_at,created_at
       FROM transparency_proofs_v2
       WHERE user_id=$1 AND device_id=$2
       ORDER BY tree_size DESC
       LIMIT 1`,
      [userId, deviceId]
    );
    return result.rows[0] ?? null;
  }

  async summary(userId: string) {
    const result = await this.db.query(
      `SELECT d.id,d.device_name,d.platform,d.status,
              p.tree_size,p.verified_at,p.created_at
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT tree_size,verified_at,created_at
         FROM transparency_proofs_v2
         WHERE user_id=d.user_id AND device_id=d.id
         ORDER BY tree_size DESC LIMIT 1
       ) p ON TRUE
       WHERE d.user_id=$1
       ORDER BY d.registered_at DESC`,
      [userId]
    );

    return result.rows;
  }

  verifyLeafHash(input: {
    userId: string;
    deviceId: string;
    keyBytes: Buffer;
    expectedLeafHash: Buffer;
  }) {
    const digest = createHash("sha256")
      .update(input.userId)
      .update(input.deviceId)
      .update(input.keyBytes)
      .digest();

    return digest.equals(input.expectedLeafHash);
  }
}
