import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";
import type { PhoneNumberNormalizationService } from "./phone-number-normalization.service.js";
import type { MobileLineIntelligenceProvider } from "./mobile-line-intelligence.service.js";
import type { PhoneRiskService } from "./phone-risk.service.js";
import type { MobileOtpService } from "./mobile-otp.service.js";

export interface PhoneCipher {
  encrypt(value: string): Promise<Buffer>;
}

export class PhoneRegistrationService {
  constructor(
    private readonly db: Database,
    private readonly normalizer: PhoneNumberNormalizationService,
    private readonly intelligence: MobileLineIntelligenceProvider,
    private readonly risk: PhoneRiskService,
    private readonly otp: MobileOtpService,
    private readonly cipher: PhoneCipher
  ) {}

  async begin(input: { userId: string; rawNumber: string; defaultCountry?: string }) {
    const normalized = this.normalizer.normalize(input.rawNumber, input.defaultCountry);

    const e164Hash = createHash("sha256").update(normalized.e164).digest();

    const duplicate = await this.db.query(
      `SELECT user_id
       FROM phone_identities_v2
       WHERE e164_hash=$1
         AND verification_state<>'REVOKED'`,
      [e164Hash]
    );

    if (duplicate.rowCount === 1 && duplicate.rows[0].user_id !== input.userId) {
      throw new Error("phone_number_already_registered");
    }

    const lookup = await this.intelligence.lookup(normalized.e164);

    const recentFailures = await this.db.query(
      `SELECT count(*)::int AS count
       FROM mobile_otp_challenges_v2 c
       JOIN phone_identities_v2 p
         ON p.id=c.phone_identity_id
       WHERE p.e164_hash=$1
         AND c.created_at>now()-interval '24 hours'
         AND c.attempt_count>0
         AND c.consumed_at IS NULL`,
      [e164Hash]
    );

    const recentAttempts = await this.db.query(
      `SELECT count(*)::int AS count
       FROM phone_verification_assessments_v2 a
       JOIN phone_identities_v2 p
         ON p.id=a.phone_identity_id
       WHERE p.e164_hash=$1
         AND a.created_at>now()-interval '24 hours'`,
      [e164Hash]
    );

    const decision = this.risk.evaluate({
      valid: lookup.valid,
      lineType: lookup.lineType,
      ...(lookup.disposable !== undefined ? { disposable: lookup.disposable } : {}),
      ...(lookup.voip !== undefined ? { voip: lookup.voip } : {}),
      ...(lookup.hosted !== undefined ? { hosted: lookup.hosted } : {}),
      ...(lookup.ported !== undefined ? { ported: lookup.ported } : {}),
      ...(lookup.simSwapRisk !== undefined ? { simSwapRisk: lookup.simSwapRisk } : {}),
      ...(lookup.riskScore !== undefined ? { providerRiskScore: lookup.riskScore } : {}),
      recentOtpFailures: Number(recentFailures.rows[0]?.count ?? 0),
      recentNumberAttempts: Number(recentAttempts.rows[0]?.count ?? 0)
    });

    const encrypted = await this.cipher.encrypt(normalized.e164);

    const state =
      decision.decision === "REJECT"
        ? lookup.lineType === "INVALID"
          ? "REJECTED_INVALID"
          : "REJECTED_VIRTUAL"
        : decision.decision === "REVIEW"
          ? "REVIEW_REQUIRED"
          : "OTP_REQUIRED";

    const phone = await this.db.query(
      `INSERT INTO phone_identities_v2(
         user_id,country_iso2,e164_ciphertext,e164_hash,
         national_number_suffix,verification_state,
         line_type,carrier_name,carrier_country,
         mobile_country_code,mobile_network_code,
         provider_reference
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(user_id)
       DO UPDATE SET
         country_iso2=EXCLUDED.country_iso2,
         e164_ciphertext=EXCLUDED.e164_ciphertext,
         e164_hash=EXCLUDED.e164_hash,
         national_number_suffix=EXCLUDED.national_number_suffix,
         verification_state=EXCLUDED.verification_state,
         line_type=EXCLUDED.line_type,
         carrier_name=EXCLUDED.carrier_name,
         carrier_country=EXCLUDED.carrier_country,
         mobile_country_code=EXCLUDED.mobile_country_code,
         mobile_network_code=EXCLUDED.mobile_network_code,
         provider_reference=EXCLUDED.provider_reference,
         updated_at=now()
       RETURNING id,verification_state`,
      [
        input.userId,
        normalized.countryIso2,
        encrypted,
        e164Hash,
        normalized.nationalNumberSuffix,
        state,
        lookup.lineType,
        lookup.carrierName ?? null,
        lookup.countryIso2 ?? null,
        lookup.mobileCountryCode ?? null,
        lookup.mobileNetworkCode ?? null,
        lookup.providerReference
      ]
    );

    const phoneIdentityId = phone.rows[0].id;

    await this.db.query(
      `INSERT INTO phone_verification_assessments_v2(
         phone_identity_id,provider,line_type,disposable,
         voip,hosted,valid,carrier_name,country_iso2,
         ported,sim_swap_risk,raw_risk_score,
         normalized_risk_score,decision,reason_codes
       ) VALUES($1,'PRIMARY',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        phoneIdentityId,
        lookup.lineType,
        lookup.disposable ?? null,
        lookup.voip ?? null,
        lookup.hosted ?? null,
        lookup.valid,
        lookup.carrierName ?? null,
        lookup.countryIso2 ?? null,
        lookup.ported ?? null,
        lookup.simSwapRisk ?? null,
        lookup.riskScore ?? null,
        decision.score,
        decision.decision,
        decision.reasons
      ]
    );

    if (decision.decision === "REJECT") {
      throw new Error("phone_number_not_eligible");
    }

    if (decision.decision === "REVIEW") {
      return {
        phoneIdentityId,
        state: "REVIEW_REQUIRED"
      };
    }

    const challenge = await this.otp.issue({
      phoneIdentityId,
      e164: normalized.e164,
      channel: "SMS"
    });

    return {
      phoneIdentityId,
      state: "OTP_REQUIRED",
      ...challenge
    };
  }

  async complete(input: { userId: string; phoneIdentityId: string; challengeId: string; code: string }) {
    await this.otp.verify({
      challengeId: input.challengeId,
      phoneIdentityId: input.phoneIdentityId,
      code: input.code
    });

    const result = await this.db.query(
      `UPDATE phone_identities_v2
       SET verification_state='VERIFIED_MOBILE',
           verified_at=now(),
           updated_at=now()
       WHERE id=$1
         AND user_id=$2
         AND verification_state='OTP_REQUIRED'
       RETURNING id,country_iso2,national_number_suffix,verified_at`,
      [input.phoneIdentityId, input.userId]
    );

    if (result.rowCount !== 1) {
      throw new Error("phone_identity_not_verifiable");
    }

    return result.rows[0];
  }
}
