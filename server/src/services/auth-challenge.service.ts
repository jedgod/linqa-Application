import type { Database } from "../db/pool.js";
import { generateOtp, verifyOtp } from "../auth/otp.js";
import { hashIp, sha256 } from "../security/hash.js";
import type { AppConfig } from "../config.js";
import type { PhoneNumberNormalizationService } from "./phone-number-normalization.service.js";
import type { MobileLineIntelligenceProvider } from "./mobile-line-intelligence.service.js";
import type { PhoneRiskService } from "./phone-risk.service.js";

export interface DeliveryProvider {
  sendSms(phone: string, code: string): Promise<void>;
  sendEmail(email: string, code: string): Promise<void>;
}

export class AuthChallengeService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly delivery: DeliveryProvider,
    private readonly phone?: {
      normalizer: PhoneNumberNormalizationService;
      intelligence: MobileLineIntelligenceProvider;
      risk: PhoneRiskService;
    }
  ) {}

  async create(input: {
    identifierType: "PHONE" | "EMAIL";
    normalizedIdentifier: string;
    purpose: "REGISTRATION" | "LOGIN" | "ADD_IDENTIFIER" | "RECOVERY" | "HIGH_RISK_ACTION";
    ip: string;
    userAgent: string;
  }) {
    const requestingIpHash = hashIp(
      this.config.IP_HASH_SECRET ?? this.config.CONTACT_DISCOVERY_SECRET,
      input.ip
    );
    // Rate-limit before invoking billable carrier intelligence. The locked
    // checks below repeat this defensively before challenge insertion.
    const preflight = await this.db.query(
      `SELECT
         count(*) FILTER (WHERE normalized_identifier=$1)::int AS identifier_count,
         count(*) FILTER (WHERE requesting_ip_hash=$2)::int AS ip_count
       FROM authentication_challenges WHERE created_at>now()-interval '1 hour'`,
      [input.normalizedIdentifier, requestingIpHash]
    );
    if (Number(preflight.rows[0]?.identifier_count ?? 0) >= 5 || Number(preflight.rows[0]?.ip_count ?? 0) >= 20) {
      throw new Error("challenge rate limit exceeded");
    }
    let phoneEvidence: null | {
      countryIso2: string; lineType: string; carrierName: string | null;
      carrierCountry: string | null; providerReference: string; riskScore: number;
      decision: string; reasons: string[];
    } = null;
    if (input.identifierType === "PHONE") {
      if (!this.phone) throw new Error("phone verification authority unavailable");
      const normalized = this.phone.normalizer.normalize(input.normalizedIdentifier);
      const lookup = await this.phone.intelligence.lookup(normalized.e164);
      const decision = this.phone.risk.evaluate({
        valid: lookup.valid, lineType: lookup.lineType,
        ...(lookup.disposable !== undefined ? { disposable: lookup.disposable } : {}),
        ...(lookup.voip !== undefined ? { voip: lookup.voip } : {}),
        ...(lookup.hosted !== undefined ? { hosted: lookup.hosted } : {}),
        ...(lookup.ported !== undefined ? { ported: lookup.ported } : {}),
        ...(lookup.simSwapRisk !== undefined ? { simSwapRisk: lookup.simSwapRisk } : {}),
        ...(lookup.riskScore !== undefined ? { providerRiskScore: lookup.riskScore } : {}),
        recentOtpFailures: 0, recentNumberAttempts: 0
      });
      if (decision.decision !== "ALLOW") throw new Error(decision.decision === "REVIEW" ? "phone_review_required" : "phone_number_not_eligible");
      phoneEvidence = {
        countryIso2: normalized.countryIso2, lineType: lookup.lineType,
        carrierName: lookup.carrierName ?? null, carrierCountry: lookup.countryIso2 ?? null,
        providerReference: lookup.providerReference, riskScore: decision.score,
        decision: decision.decision, reasons: decision.reasons
      };
    }
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

      const recentFromIp = await client.query(
        `SELECT count(*)::int AS count
         FROM authentication_challenges
         WHERE requesting_ip_hash = $1
           AND created_at > now() - interval '1 hour'`,
        [requestingIpHash]
      );
      if ((recentFromIp.rows[0]?.count ?? 0) >= 20) {
        throw new Error("challenge source rate limit exceeded");
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
           requesting_user_agent_hash,phone_country_iso2,phone_line_type,
           phone_carrier_name,phone_carrier_country,phone_provider_reference,
           phone_risk_score,phone_risk_decision,phone_risk_reasons
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,5,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
          requestingIpHash,
          sha256(input.userAgent),
          phoneEvidence?.countryIso2 ?? null, phoneEvidence?.lineType ?? null,
          phoneEvidence?.carrierName ?? null, phoneEvidence?.carrierCountry ?? null,
          phoneEvidence?.providerReference ?? null, phoneEvidence?.riskScore ?? null,
          phoneEvidence?.decision ?? null, phoneEvidence?.reasons ?? []
        ]
      );

      if (input.identifierType === "PHONE") {
        await this.delivery.sendSms(input.normalizedIdentifier, otp.code);
      } else {
        await this.delivery.sendEmail(input.normalizedIdentifier, otp.code);
      }

      await client.query("COMMIT");

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
