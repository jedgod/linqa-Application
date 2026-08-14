import type { Database } from "../../db/pool.js";
import type { AppConfig } from "../../config.js";
import type { SubscriptionProvider, DiscoveryMode } from "./entitlements.js";
import { assertEntitled, discoveryEntitlements } from "./entitlements.js";
import type { PhoneEvidenceProvider, GeoIpProvider } from "./providers.js";
import { evaluateCountryRisk } from "./risk.js";

export class CountryLinqaService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly subscriptions: SubscriptionProvider,
    private readonly phoneEvidence: PhoneEvidenceProvider,
    private readonly geoIp: GeoIpProvider
  ) {}

  async catalog() {
    const countries = await this.db.query(
      `SELECT code, iso3, name, calling_code AS "callingCode", region_code AS "regionCode"
       FROM countries WHERE enabled = TRUE ORDER BY name`
    );
    const regions = await this.db.query(
      `SELECT code, name, parent_code AS "parentCode"
       FROM geographic_regions WHERE enabled = TRUE ORDER BY sort_order, name`
    );
    return { countries: countries.rows, regions: regions.rows };
  }

  async preferences(userId: string) {
    const [preferences, tier] = await Promise.all([
      this.preferencesWithClient(this.db, userId), this.subscriptions.getTier(userId)
    ]);
    return { ...preferences, subscriptionTier: tier, allowedModes: discoveryEntitlements(tier) };
  }

  private async preferencesWithClient(client: { query: Database["query"] }, userId: string) {
    const result = await client.query(
      `SELECT
         u.verified_country_code AS "verifiedCountryCode",
         u.country_verification_state AS "verificationState",
         u.location_precision AS "locationPrecision",
         u.show_city AS "showCity",
         COALESCE(p.mode, 'MY_COUNTRY') AS mode,
         COALESCE((SELECT json_agg(cl.country_code) FROM country_links cl WHERE cl.user_id = u.id), '[]'::json) AS "selectedCountries",
         COALESCE((SELECT json_agg(rl.region_code) FROM regional_links rl WHERE rl.user_id = u.id), '[]'::json) AS "selectedRegions"
       FROM users u
       LEFT JOIN country_discovery_preferences p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      const error: any = new Error("User not found");
      error.status = 404;
      throw error;
    }
    return row;
  }

  async savePreferences(
    userId: string,
    input: {
      mode: DiscoveryMode;
      selectedCountries: string[];
      selectedRegions: string[];
      locationPrecision: "COUNTRY" | "STATE" | "CITY";
      showCity: boolean;
    }
  ) {
    const tier = await this.subscriptions.getTier(userId);
    const countries = Array.from(new Set(input.selectedCountries.map((c) => c.toUpperCase())));
    const regions = Array.from(new Set(input.selectedRegions.map((r) => r.toUpperCase())));

    assertEntitled(tier, input.mode, countries.length, regions.length, this.config);

    if (input.mode === "SELECTED_COUNTRIES" && countries.length === 0) {
      const error: any = new Error("At least one country is required.");
      error.status = 422;
      error.code = "COUNTRY_REQUIRED";
      throw error;
    }
    if (input.mode === "REGION" && regions.length === 0) {
      const error: any = new Error("At least one region is required.");
      error.status = 422;
      error.code = "REGION_REQUIRED";
      throw error;
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      if (countries.length > 0) {
        const found = await client.query(
          `SELECT code FROM countries WHERE code = ANY($1) AND enabled = TRUE`,
          [countries]
        );
        if (found.rowCount !== countries.length) {
          const error: any = new Error("One or more selected countries are invalid.");
          error.status = 422;
          error.code = "INVALID_COUNTRY";
          throw error;
        }
      }
      if (regions.length > 0) {
        const found = await client.query(
          `SELECT code FROM geographic_regions WHERE code = ANY($1) AND enabled = TRUE`,
          [regions]
        );
        if (found.rowCount !== regions.length) {
          const error: any = new Error("One or more selected regions are invalid.");
          error.status = 422;
          error.code = "INVALID_REGION";
          throw error;
        }
      }

      await client.query(
        `INSERT INTO country_discovery_preferences (user_id, mode)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()`,
        [userId, input.mode]
      );

      await client.query(`DELETE FROM country_links WHERE user_id = $1`, [userId]);
      for (const code of countries) {
        await client.query(`INSERT INTO country_links (user_id, country_code) VALUES ($1, $2)`, [userId, code]);
      }

      await client.query(`DELETE FROM regional_links WHERE user_id = $1`, [userId]);
      for (const code of regions) {
        await client.query(`INSERT INTO regional_links (user_id, region_code) VALUES ($1, $2)`, [userId, code]);
      }

      const showCity = input.locationPrecision === "CITY" ? input.showCity : false;
      await client.query(
        `UPDATE users SET location_precision = $2, show_city = $3 WHERE id = $1`,
        [userId, input.locationPrecision, showCity]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.preferences(userId);
  }

  async confirmCountry(
    userId: string,
    input: { claimedCountryCode: string; simCountryCode?: string | undefined; localeCountryCode?: string | undefined },
    requestIp: string
  ) {
    const current = await this.db.query(
      `SELECT verified_country_code,country_verification_state FROM users WHERE id=$1`, [userId]
    );
    const currentCountry = current.rows[0]?.verified_country_code as string | null | undefined;
    if (currentCountry && currentCountry !== input.claimedCountryCode.toUpperCase()) {
      const error: any = new Error("Verified-country migration requires step-up authentication.");
      error.status = 403; error.code = "COUNTRY_CHANGE_STEP_UP_REQUIRED"; throw error;
    }
    if (currentCountry && current.rows[0]?.country_verification_state === "VERIFIED") {
      return { verifiedCountryCode: currentCountry, claimedCountryCode: input.claimedCountryCode,
        verificationState: "VERIFIED", riskScore: 0, reviewRequired: false, idempotent: true };
    }
    const trusted = await this.phoneEvidence.getEvidenceForUser(userId);
    const ipCountryCode = await this.geoIp.resolveCountry(requestIp);

    const risk = evaluateCountryRisk({
      phoneCountryCode: trusted.phoneCountryCode,
      carrierCountryCode: trusted.carrierCountryCode ?? null,
      simCountryCode: input.simCountryCode ?? null,
      ipCountryCode: ipCountryCode ?? null,
      localeCountryCode: input.localeCountryCode ?? null,
      claimedCountryCode: input.claimedCountryCode,
      lineType: trusted.lineType ?? null,
      phoneVerified: trusted.phoneVerified
    });

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO country_verification_evidence (
           user_id, phone_country_code, carrier_country_code, sim_country_code,
           ip_country_code, locale_country_code, user_claimed_country_code,
           line_type, carrier_name, phone_verified, risk_score, risk_reasons, evidence
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          userId,
          trusted.phoneCountryCode,
          trusted.carrierCountryCode ?? null,
          input.simCountryCode ?? null,
          ipCountryCode ?? null,
          input.localeCountryCode ?? null,
          input.claimedCountryCode,
          trusted.lineType ?? null,
          trusted.carrierName ?? null,
          trusted.phoneVerified,
          risk.score,
          JSON.stringify(risk.reasons),
          JSON.stringify({ trusted, ipCountryCode })
        ]
      );

      if (risk.score >= 40) {
        await client.query(
          `INSERT INTO country_risk_events (user_id, event_type, severity, score_delta, details)
           VALUES ($1, 'COUNTRY_SIGNAL_MISMATCH', $2, $3, $4)`,
          [userId, risk.score >= 80 ? "HIGH" : "MEDIUM", risk.score, JSON.stringify({ reasons: risk.reasons })]
        );
      }

      await client.query(
        `UPDATE users
         SET verified_country_code = $2, country_verification_state = $3,
             country_verified_at = CASE WHEN $3 = 'VERIFIED' THEN now() ELSE country_verified_at END
         WHERE id = $1`,
        [userId, trusted.phoneCountryCode, risk.state]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      verifiedCountryCode: trusted.phoneCountryCode,
      claimedCountryCode: input.claimedCountryCode,
      verificationState: risk.state,
      riskScore: risk.score,
      reviewRequired: risk.state === "REVIEW_REQUIRED" || risk.state === "RESTRICTED"
    };
  }

  async requestCountryClarification(userId: string, proposedCountryCode?: string) {
    const proposed = proposedCountryCode?.toUpperCase() ?? null;
    if (proposed) {
      const country = await this.db.query(`SELECT 1 FROM countries WHERE code=$1 AND enabled=TRUE`, [proposed]);
      if (country.rowCount !== 1) {
        const error: any = new Error("Proposed country is invalid.");
        error.status = 422; error.code = "INVALID_COUNTRY"; throw error;
      }
    }
    const trusted = await this.phoneEvidence.getEvidenceForUser(userId);
    await this.db.query(
      `INSERT INTO country_risk_events(user_id,event_type,severity,score_delta,details)
       VALUES($1,'COUNTRY_CLARIFICATION_REQUESTED','MEDIUM',0,$2)`,
      [userId, { detectedCountryCode: trusted.phoneCountryCode, proposedCountryCode: proposed }]
    );
    await this.db.query(
      `UPDATE users SET country_verification_state='REVIEW_REQUIRED' WHERE id=$1 AND verified_country_code IS NULL`,
      [userId]
    );
    return { reviewRequired: true, detectedCountryCode: trusted.phoneCountryCode, proposedCountryCode: proposed };
  }
}
