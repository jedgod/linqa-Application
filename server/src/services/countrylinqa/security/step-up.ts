import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "../../../db/pool.js";
import { sha256Hex } from "./crypto.js";
import { securityLog } from "./security-log.js";

export class StepUpService {
  constructor(private readonly db: Database) {}

  async createChallenge(userId: string, purpose: string) {
    const challenge = randomBytes(32).toString("base64url");
    const challengeHash = sha256Hex(challenge);

    const result = await this.db.query(
      `INSERT INTO countrylinqa_stepup_challenges (user_id, purpose, challenge_hash, expires_at)
       VALUES ($1,$2,$3, now() + interval '10 minutes')
       RETURNING id, expires_at`,
      [userId, purpose, challengeHash]
    );

    return {
      challengeId: result.rows[0].id as string,
      challenge,
      expiresAt: result.rows[0].expires_at
    };
  }

  async consumeChallenge(userId: string, challengeId: string, challenge: string, purpose: string): Promise<true> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT * FROM countrylinqa_stepup_challenges WHERE id = $1 AND user_id = $2 AND purpose = $3 FOR UPDATE`,
        [challengeId, userId, purpose]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        const error: any = new Error("Step-up challenge not found.");
        error.status = 404;
        error.code = "STEPUP_NOT_FOUND";
        throw error;
      }
      if (row.consumed_at) {
        await client.query("ROLLBACK");
        const error: any = new Error("Step-up challenge already used.");
        error.status = 409;
        error.code = "STEPUP_ALREADY_USED";
        throw error;
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        const error: any = new Error("Step-up challenge expired.");
        error.status = 401;
        error.code = "STEPUP_EXPIRED";
        throw error;
      }
      if (row.attempts >= row.max_attempts) {
        await client.query("ROLLBACK");
        const error: any = new Error("Step-up challenge locked.");
        error.status = 423;
        error.code = "STEPUP_LOCKED";
        throw error;
      }

      const provided = Buffer.from(sha256Hex(challenge));
      const stored = Buffer.from(row.challenge_hash as string);
      const matches = provided.length === stored.length && timingSafeEqual(provided, stored);

      if (!matches) {
        await client.query(`UPDATE countrylinqa_stepup_challenges SET attempts = attempts + 1 WHERE id = $1`, [challengeId]);
        await client.query("COMMIT");
        await securityLog(this.db, { userId, eventType: "STEPUP_FAILED", severity: "MEDIUM" });
        const error: any = new Error("Step-up challenge invalid.");
        error.status = 401;
        error.code = "STEPUP_INVALID";
        throw error;
      }

      await client.query(`UPDATE countrylinqa_stepup_challenges SET consumed_at = now() WHERE id = $1`, [challengeId]);
      await client.query("COMMIT");
      await securityLog(this.db, { userId, eventType: "STEPUP_SUCCEEDED", severity: "INFO" });
      return true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
