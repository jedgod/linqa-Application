import { randomBytes } from "node:crypto";
import type { Database } from "../db/pool.js";
import { hashToken } from "../auth/tokens.js";

export class RecoveryCodeService {
  constructor(private readonly db: Database) {}

  async regenerate(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () =>
      randomBytes(8).toString("hex").match(/.{1,4}/g)!.join("-")
    );

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);

      for (const code of codes) {
        await client.query(
          `INSERT INTO recovery_codes (user_id, code_hash)
           VALUES ($1, $2)`,
          [userId, hashToken(code)]
        );
      }

      await client.query("COMMIT");
      return codes;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async consume(userId: string, code: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE recovery_codes
       SET used_at = now()
       WHERE user_id = $1
         AND code_hash = $2
         AND used_at IS NULL`,
      [userId, hashToken(code)]
    );
    return (result.rowCount ?? 0) === 1;
  }
}
