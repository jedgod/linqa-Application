import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Database } from "../db/pool.js";
import type { PhoneCipher } from "./phone-registration.service.js";
import type { RecoveryEmailDelivery } from "./email-delivery.service.js";

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("invalid_recovery_email");
  }
  return email;
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function mask(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export class RecoveryEmailService {
  constructor(
    private readonly db: Database,
    private readonly cipher: PhoneCipher,
    private readonly delivery: RecoveryEmailDelivery
  ) {}

  async begin(userId: string, rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const emailHash = hash(email);
    const encrypted = await this.cipher.encrypt(email);
    const duplicate = await this.db.query(
      `SELECT user_id FROM recovery_email_identities_v3
       WHERE email_hash=$1 AND verification_state<>'REVOKED'`,
      [emailHash]
    );
    if (duplicate.rows[0] && duplicate.rows[0].user_id !== userId) {
      throw new Error("recovery_email_already_registered");
    }

    const identity = await this.db.query(
      `INSERT INTO recovery_email_identities_v3(
         user_id,email_ciphertext,email_hash,masked_email,verification_state
       ) VALUES($1,$2,$3,$4,'OTP_REQUIRED')
       ON CONFLICT(user_id) DO UPDATE SET
         email_ciphertext=EXCLUDED.email_ciphertext,
         email_hash=EXCLUDED.email_hash,
         masked_email=EXCLUDED.masked_email,
         verification_state='OTP_REQUIRED',verified_at=NULL,updated_at=now()
       RETURNING id,masked_email`,
      [userId, encrypted, emailHash, mask(email)]
    );
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const challenge = await this.db.query(
      `INSERT INTO recovery_email_otp_challenges_v3(
         recovery_email_identity_id,code_hash,expires_at
       ) VALUES($1,$2,now()+interval '10 minutes') RETURNING id,expires_at`,
      [identity.rows[0].id, hash(code)]
    );

    await this.delivery.sendVerification({ destination: email, code });
    return {
      identityId: identity.rows[0].id,
      challengeId: challenge.rows[0].id,
      maskedEmail: identity.rows[0].masked_email,
      expiresAt: challenge.rows[0].expires_at
    };
  }

  async verify(userId: string, identityId: string, challengeId: string, code: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT c.* FROM recovery_email_otp_challenges_v3 c
         JOIN recovery_email_identities_v3 e ON e.id=c.recovery_email_identity_id
         WHERE c.id=$1 AND e.id=$2 AND e.user_id=$3
           AND c.consumed_at IS NULL AND c.expires_at>now() FOR UPDATE`,
        [challengeId, identityId, userId]
      );
      const row = result.rows[0];
      if (!row || row.attempt_count >= row.max_attempts) throw new Error("email_otp_invalid");
      const candidate = hash(code);
      const expected: Buffer = row.code_hash;
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
        await client.query(
          `UPDATE recovery_email_otp_challenges_v3 SET attempt_count=attempt_count+1 WHERE id=$1`,
          [challengeId]
        );
        await client.query("COMMIT");
        throw new Error("email_otp_invalid");
      }
      await client.query(
        `UPDATE recovery_email_otp_challenges_v3
         SET consumed_at=now(),attempt_count=attempt_count+1 WHERE id=$1`,
        [challengeId]
      );
      await client.query(
        `UPDATE recovery_email_identities_v3
         SET verification_state='VERIFIED',verified_at=now(),updated_at=now()
         WHERE id=$1 AND user_id=$2`,
        [identityId, userId]
      );
      await client.query("COMMIT");
      return { verified: true };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}
