import type { Database } from "../db/pool.js";
import { generateOtp, verifyOtp } from "../auth/otp.js";
import { hashIp, sha256 } from "../security/hash.js";
import type { AppConfig } from "../config.js";

export interface DeliveryProvider {
  sendSms(phone: string, code: string): Promise<void>;
  sendEmail(email: string, code: string): Promise<void>;
}

export class AuthChallengeService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly delivery: DeliveryProvider
  ) {}

  async create(input: {
    identifierType: "PHONE" | "EMAIL";
    normalizedIdentifier: string;
    purpose: "REGISTRATION" | "LOGIN" | "ADD_IDENTIFIER" | "RECOVERY" | "HIGH_RISK_ACTION";
    ip: string;
    userAgent: string;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const recent = await client.query(
        `SELECT count(*)::int AS count
         FROM authentication_challenges
         WHERE normalized_identifier = $1
           AND created_at > now() - interval '1 hour'`,
        [input.normalizedIdentifier]
      );

      if ((recent.rows[0]?.count ?? 0) >= 5) {
        throw new Error("challenge rate limit exceeded");
      }

      await client.query(
        `UPDATE authentication_challenges
         SET superseded_at = now()
         WHERE normalized_identifier = $1
           AND purpose = $2
           AND consumed_at IS NULL
           AND superseded_at IS NULL`,
        [input.normalizedIdentifier, input.purpose]
      );

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const resendAfter = new Date(Date.now() + 30 * 1000);

      const inserted = await client.query(
        `INSERT INTO authentication_challenges (
           identifier_type,
           normalized_identifier,
           purpose,
           channel,
           code_hash,
           code_salt,
           expires_at,
           resend_after,
           attempts_remaining,
           requesting_ip_hash,
           requesting_user_agent_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,5,$9,$10)
         RETURNING id, expires_at, resend_after`,
        [
          input.identifierType,
          input.normalizedIdentifier,
          input.purpose,
          input.identifierType === "PHONE" ? "SMS" : "EMAIL",
          otp.hash,
          otp.salt,
          expiresAt,
          resendAfter,
          hashIp(this.config.JWT_HS256_SECRET, input.ip),
          sha256(input.userAgent)
        ]
      );

      await client.query("COMMIT");

      if (input.identifierType === "PHONE") {
        await this.delivery.sendSms(input.normalizedIdentifier, otp.code);
      } else {
        await this.delivery.sendEmail(input.normalizedIdentifier, otp.code);
      }

      return {
        challengeId: inserted.rows[0].id as string,
        expiresAt: inserted.rows[0].expires_at as Date,
        resendAfter: inserted.rows[0].resend_after as Date
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async verify(input: {
    challengeId: string;
    code: string;
  }): Promise<{
    normalizedIdentifier: string;
    identifierType: "PHONE" | "EMAIL";
    purpose: string;
  }> {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT *
         FROM authentication_challenges
         WHERE id = $1
         FOR UPDATE`,
        [input.challengeId]
      );
      const row = result.rows[0];

      if (
        !row ||
        row.consumed_at ||
        row.superseded_at ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        row.attempts_remaining <= 0
      ) {
        throw new Error("invalid or expired challenge");
      }

      const valid = verifyOtp(input.code, row.code_salt, row.code_hash);
      if (!valid) {
        await client.query(
          `UPDATE authentication_challenges
           SET attempts_remaining = GREATEST(attempts_remaining - 1, 0)
           WHERE id = $1`,
          [input.challengeId]
        );
        await client.query("COMMIT");
        throw new Error("invalid code");
      }

      await client.query(
        `UPDATE authentication_challenges
         SET consumed_at = now()
         WHERE id = $1`,
        [input.challengeId]
      );

      await client.query("COMMIT");

      return {
        normalizedIdentifier: row.normalized_identifier,
        identifierType: row.identifier_type,
        purpose: row.purpose
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}
