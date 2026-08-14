import type { Database } from "../../../db/pool.js";
import type { PhoneEvidenceProvider, GeoIpProvider } from "../providers.js";
import { evaluateCountryRisk } from "../risk.js";
import { auditCountryLinqa } from "./audit.js";
import { guardCountrySensitiveChange } from "../security/country-change-guard.js";
import { registerDeviceObservation } from "../security/device-trust.js";
import { StepUpService } from "../security/step-up.js";

export class CountryReverificationService {
  constructor(
    private readonly db: Database,
    private readonly phone: PhoneEvidenceProvider,
    private readonly geoIp: GeoIpProvider
  ) {}

  /**
   * Re-verifying an already-established verified country is the sensitive
   * change the security pack's step-up flow is meant to protect — unlike
   * the first-ever confirmCountry() call (no prior state to protect,
   * already verified working end-to-end this session), this requires a
   * freshly consumed COUNTRY_CHANGE step-up challenge plus the device's
   * observed trust state.
   */
  async reverify(
    userId: string,
    requestIp: string,
    input: { deviceId: string; stepUpChallengeId: string; stepUpChallenge: string }
  ) {
    const current = await this.db.query(
      `SELECT verified_country_code, country_verification_state FROM users WHERE id = $1`,
      [userId]
    );
    const row = current.rows[0];
    if (!row) {
      const error: any = new Error("User not found");
      error.status = 404;
      throw error;
    }

    const deviceTrust = await registerDeviceObservation(this.db, userId, input.deviceId);
    const stepUp = new StepUpService(this.db);
    await stepUp.consumeChallenge(userId, input.stepUpChallengeId, input.stepUpChallenge, "COUNTRY_CHANGE");

    const evidence = await this.phone.getEvidenceForUser(userId);
    const ipCountryCode = await this.geoIp.resolveCountry(requestIp);

    const risk = evaluateCountryRisk({
      phoneCountryCode: evidence.phoneCountryCode,
      carrierCountryCode: evidence.carrierCountryCode ?? null,
      ipCountryCode: ipCountryCode ?? null,
      lineType: evidence.lineType ?? null,
      claimedCountryCode: evidence.phoneCountryCode,
      phoneVerified: evidence.phoneVerified
    });

    await guardCountrySensitiveChange(this.db, {
      userId,
      operation: "COUNTRY_REVERIFY",
      deviceTrust,
      stepUpSatisfied: true,
      riskScore: risk.score
    });

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO country_verification_evidence
           (user_id, phone_country_code, carrier_country_code, ip_country_code, line_type, carrier_name, phone_verified, risk_score, risk_reasons, evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          userId,
          evidence.phoneCountryCode,
          evidence.carrierCountryCode ?? null,
          ipCountryCode ?? null,
          evidence.lineType ?? null,
          evidence.carrierName ?? null,
          evidence.phoneVerified,
          risk.score,
          JSON.stringify(risk.reasons),
          JSON.stringify({ evidence, ipCountryCode })
        ]
      );
      await client.query(
        `UPDATE users
         SET verified_country_code = $2, country_verification_state = $3,
             country_verified_at = CASE WHEN $3 = 'VERIFIED' THEN now() ELSE country_verified_at END
         WHERE id = $1`,
        [userId, evidence.phoneCountryCode, risk.state]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await auditCountryLinqa(this.db, {
      userId,
      eventType: "COUNTRY_REVERIFIED",
      oldValue: { country: row.verified_country_code, state: row.country_verification_state },
      newValue: { country: evidence.phoneCountryCode, state: risk.state }
    });

    return {
      oldCountry: row.verified_country_code,
      newCountry: evidence.phoneCountryCode,
      state: risk.state,
      riskScore: risk.score
    };
  }
}
