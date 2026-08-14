import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";
import type { PhoneNumberNormalizationService } from "./phone-number-normalization.service.js";

export interface PhoneCipher { encrypt(value: string): Promise<Buffer>; }

/**
 * Materializes phone identity from the single server-authoritative auth OTP.
 * Carrier assessment and OTP issuance live in AuthChallengeService; this
 * service deliberately has no begin/complete or delivery capability.
 */
export class PhoneRegistrationService {
  constructor(private readonly db: Database, private readonly normalizer: PhoneNumberNormalizationService, private readonly cipher: PhoneCipher) {}

  async adoptVerifiedAuthChallenge(userId: string, challengeId: string) {
    const challenge = await this.db.query(
      `SELECT * FROM authentication_challenges WHERE id=$1 AND identifier_type='PHONE'
       AND consumed_at IS NOT NULL AND consumed_at>now()-interval '10 minutes'`, [challengeId]
    );
    const row = challenge.rows[0];
    if (!row || row.phone_risk_decision !== "ALLOW") throw new Error("verified_phone_evidence_required");
    const existing = await this.db.query(
      `SELECT id FROM phone_identities_v2 WHERE user_id=$1 AND verification_state='VERIFIED_MOBILE'`, [userId]
    );
    if (existing.rowCount === 1) return existing.rows[0];

    const e164 = String(row.normalized_identifier); const normalized = this.normalizer.normalize(e164);
    const e164Hash = createHash("sha256").update(e164).digest(); const encrypted = await this.cipher.encrypt(e164);
    const result = await this.db.query(
      `INSERT INTO phone_identities_v2(user_id,country_iso2,e164_ciphertext,e164_hash,
         national_number_suffix,verification_state,line_type,carrier_name,carrier_country,
         provider_reference,verified_at)
       VALUES($1,$2,$3,$4,$5,'VERIFIED_MOBILE',$6,$7,$8,$9,now())
       ON CONFLICT(user_id) DO UPDATE SET country_iso2=EXCLUDED.country_iso2,
         e164_ciphertext=EXCLUDED.e164_ciphertext,e164_hash=EXCLUDED.e164_hash,
         national_number_suffix=EXCLUDED.national_number_suffix,verification_state='VERIFIED_MOBILE',
         line_type=EXCLUDED.line_type,carrier_name=EXCLUDED.carrier_name,
         carrier_country=EXCLUDED.carrier_country,provider_reference=EXCLUDED.provider_reference,
         verified_at=now(),updated_at=now() RETURNING id`,
      [userId, row.phone_country_iso2 ?? normalized.countryIso2, encrypted, e164Hash,
        normalized.nationalNumberSuffix, row.phone_line_type, row.phone_carrier_name,
        row.phone_carrier_country, row.phone_provider_reference]
    );
    await this.db.query(
      `INSERT INTO phone_verification_assessments_v2(phone_identity_id,provider,line_type,valid,
         carrier_name,country_iso2,normalized_risk_score,decision,reason_codes)
       VALUES($1,'AUTH_PHONE_AUTHORITY',$2,TRUE,$3,$4,$5,'ALLOW',$6)`,
      [result.rows[0].id, row.phone_line_type, row.phone_carrier_name,
        row.phone_carrier_country ?? row.phone_country_iso2, row.phone_risk_score, row.phone_risk_reasons]
    );
    return result.rows[0];
  }
}
