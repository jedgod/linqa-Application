import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Database } from "../db/pool.js";

export interface OtpDeliveryProvider {
  sendSms(input: { destination: string; code: string }): Promise<void>;
  sendVoice(input: { destination: string; code: string }): Promise<void>;
}

/**
 * No SMS/voice OTP provider is configured in this environment (see
 * APPLY_GUIDE.txt item 6). Not part of the source pack — added to match
 * the fail-closed-default convention already used everywhere else in this
 * repo for unconfigured external providers
 * (FailClosedMobileLineIntelligenceProvider, FailClosedPushProvider,
 * FailClosedObjectStorage, ...).
 */
export class FailClosedOtpDeliveryProvider implements OtpDeliveryProvider {
  async sendSms(): Promise<never> {
    throw new Error("SMS OTP provider is not configured.");
  }
  async sendVoice(): Promise<never> {
    throw new Error("Voice OTP provider is not configured.");
  }
}

/**
 * Development-only stand-in, same precedent as
 * `services/delivery/dev-console.provider.ts`'s DevConsoleDeliveryProvider
 * (which covers the separate `/v1/auth/challenges` OTP flow, not this
 * multi-account phone-verification OTP flow) — logs the code instead of
 * sending it, so `/v5/phone-verification/start` is exercisable locally.
 */
export class DevConsoleMobileOtpDeliveryProvider implements OtpDeliveryProvider {
  constructor(config: { NODE_ENV: string }) {
    if (config.NODE_ENV === "production") {
      throw new Error(
        "DevConsoleMobileOtpDeliveryProvider must not be used in production; configure a real SMS/voice provider."
      );
    }
  }

  async sendSms(input: { destination: string; code: string }): Promise<void> {
    console.log(`[dev-delivery] Multi-account SMS OTP for ${input.destination}: ${input.code} (DEV ONLY — never logged in production)`);
  }

  async sendVoice(input: { destination: string; code: string }): Promise<void> {
    console.log(`[dev-delivery] Multi-account voice OTP for ${input.destination}: ${input.code} (DEV ONLY — never logged in production)`);
  }
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest();
}

export class MobileOtpService {
  constructor(
    private readonly db: Database,
    private readonly provider: OtpDeliveryProvider
  ) {}

  async issue(input: { phoneIdentityId: string; e164: string; channel: "SMS" | "VOICE" }) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

    const destinationHash = createHash("sha256").update(input.e164).digest();

    const result = await this.db.query(
      `INSERT INTO mobile_otp_challenges_v2(
         phone_identity_id,channel,destination_hash,
         code_hash,expires_at
       ) VALUES($1,$2,$3,$4,now()+interval '5 minutes')
       RETURNING id,expires_at`,
      [input.phoneIdentityId, input.channel, destinationHash, hashCode(code)]
    );

    if (input.channel === "SMS") {
      await this.provider.sendSms({ destination: input.e164, code });
    } else {
      await this.provider.sendVoice({ destination: input.e164, code });
    }

    return {
      challengeId: result.rows[0].id,
      expiresAt: result.rows[0].expires_at
    };
  }

  async verify(input: { challengeId: string; phoneIdentityId: string; code: string }) {
    const result = await this.db.query(
      `SELECT *
       FROM mobile_otp_challenges_v2
       WHERE id=$1
         AND phone_identity_id=$2
         AND consumed_at IS NULL
         AND expires_at>now()
       FOR UPDATE`,
      [input.challengeId, input.phoneIdentityId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("otp_challenge_invalid_or_expired");
    }

    if (row.attempt_count >= row.max_attempts) {
      throw new Error("otp_attempt_limit_reached");
    }

    const candidate = hashCode(input.code);
    const expected: Buffer = row.code_hash;

    const valid = candidate.length === expected.length && timingSafeEqual(candidate, expected);

    if (!valid) {
      await this.db.query(
        `UPDATE mobile_otp_challenges_v2
         SET attempt_count=attempt_count+1
         WHERE id=$1`,
        [input.challengeId]
      );

      throw new Error("otp_invalid");
    }

    await this.db.query(
      `UPDATE mobile_otp_challenges_v2
       SET consumed_at=now(),
           attempt_count=attempt_count+1
       WHERE id=$1`,
      [input.challengeId]
    );

    return { verified: true };
  }
}
