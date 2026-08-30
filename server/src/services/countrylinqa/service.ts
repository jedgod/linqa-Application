import type { Database } from "../../db/pool.js";
import type { AppConfig } from "../../config.js";
import type { SubscriptionProvider, DiscoveryMode } from "./entitlements.js";
import { assertEntitled, discoveryEntitlements } from "./entitlements.js";
import type { PhoneEvidenceProvider, GeoIpProvider } from "./providers.js";
import { evaluateCountryRisk } from "./risk.js";

export type InboundReach = DiscoveryMode | "CONTACTS_ONLY";

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
    return {
      ...preferences,
      subscriptionTier: tier,
      allowedModes: discoveryEntitlements(tier),
      selectionLimits: {
        countries: tier === "FREE" ? 0 : tier === "PREMIUM" ? this.config.COUNTRY_SELECTION_PREMIUM_LIMIT : 250,
        regions: tier === "FREE" ? 0 : tier === "PREMIUM" ? 10 : 50
      }
    };
  }

  private async preferencesWithClient(client: { query: Database["query"] }, userId: string) {
    const result = await client.query(
      `SELECT
         u.verified_country_code AS "verifiedCountryCode",
         u.country_verification_state AS "verificationState",
         u.location_precision AS "locationPrecision",
         u.show_city AS "showCity",
         COALESCE(p.mode, 'MY_COUNTRY') AS mode,
         COALESCE(p.inbound_reach, 'MY_COUNTRY') AS "inboundReach",
         COALESCE(p.show_country, TRUE) AS "showCountry",
         COALESCE(p.show_state, FALSE) AS "showState",
         COALESCE(p.verified_only, TRUE) AS "verifiedOnly",
         COALESCE(p.allow_businesses, TRUE) AS "allowBusinesses",
         COALESCE(p.allow_communities, TRUE) AS "allowCommunities",
         COALESCE(p.allow_events, TRUE) AS "allowEvents",
         COALESCE(NOT p.enabled, FALSE) AS paused,
         COALESCE((SELECT json_agg(cl.country_code) FROM country_links cl WHERE cl.user_id = u.id), '[]'::json) AS "selectedCountries",
         COALESCE((SELECT json_agg(rl.region_code) FROM regional_links rl WHERE rl.user_id = u.id), '[]'::json) AS "selectedRegions",
         COALESCE((SELECT json_agg(cl.country_code) FROM country_inbound_links cl WHERE cl.user_id = u.id), '[]'::json) AS "inboundSelectedCountries",
         COALESCE((SELECT json_agg(rl.region_code) FROM regional_inbound_links rl WHERE rl.user_id = u.id), '[]'::json) AS "inboundSelectedRegions"
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
      locationPrecision?: "COUNTRY" | "STATE" | "CITY" | undefined;
      showCity?: boolean | undefined;
      inboundReach?: InboundReach | undefined;
      inboundSelectedCountries?: string[] | undefined;
      inboundSelectedRegions?: string[] | undefined;
      showCountry?: boolean | undefined;
      showState?: boolean | undefined;
      verifiedOnly?: boolean | undefined;
      allowBusinesses?: boolean | undefined;
      allowCommunities?: boolean | undefined;
      allowEvents?: boolean | undefined;
      paused?: boolean | undefined;
    }
  ) {
    const tier = await this.subscriptions.getTier(userId);
    const countries = Array.from(new Set(input.selectedCountries.map((c) => c.toUpperCase())));
    const regions = Array.from(new Set(input.selectedRegions.map((r) => r.toUpperCase())));
    const inboundCountries = input.inboundSelectedCountries === undefined ? undefined
      : Array.from(new Set(input.inboundSelectedCountries.map((c) => c.toUpperCase())));
    const inboundRegions = input.inboundSelectedRegions === undefined ? undefined
      : Array.from(new Set(input.inboundSelectedRegions.map((r) => r.toUpperCase())));

    assertEntitled(tier, input.mode, countries.length, regions.length, this.config);
    if (input.inboundReach && input.inboundReach !== "CONTACTS_ONLY") {
      assertEntitled(tier, input.inboundReach, inboundCountries?.length ?? 0, inboundRegions?.length ?? 0, this.config);
    }

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
    if (input.inboundReach === "SELECTED_COUNTRIES" && (inboundCountries?.length ?? 0) === 0) {
      const error: any = new Error("At least one inbound country is required.");
      error.status = 422;
      error.code = "INBOUND_COUNTRY_REQUIRED";
      throw error;
    }
    if (input.inboundReach === "REGION" && (inboundRegions?.length ?? 0) === 0) {
      const error: any = new Error("At least one inbound region is required.");
      error.status = 422;
      error.code = "INBOUND_REGION_REQUIRED";
      throw error;
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const allCountries = Array.from(new Set([...countries, ...(inboundCountries ?? [])]));
      if (allCountries.length > 0) {
        const found = await client.query(
          `SELECT code FROM countries WHERE code = ANY($1) AND enabled = TRUE`,
          [allCountries]
        );
        if (found.rowCount !== allCountries.length) {
          const error: any = new Error("One or more selected countries are invalid.");
          error.status = 422;
          error.code = "INVALID_COUNTRY";
          throw error;
        }
      }
      const allRegions = Array.from(new Set([...regions, ...(inboundRegions ?? [])]));
      if (allRegions.length > 0) {
        const found = await client.query(
          `SELECT code FROM geographic_regions WHERE code = ANY($1) AND enabled = TRUE`,
          [allRegions]
        );
        if (found.rowCount !== allRegions.length) {
          const error: any = new Error("One or more selected regions are invalid.");
          error.status = 422;
          error.code = "INVALID_REGION";
          throw error;
        }
      }

      await client.query(
        `INSERT INTO country_discovery_preferences (
           user_id, mode, inbound_reach, show_country, show_state, verified_only,
           allow_businesses, allow_communities, allow_events, enabled
         ) VALUES ($1,$2,COALESCE($3::country_inbound_reach,'MY_COUNTRY'),COALESCE($4,TRUE),COALESCE($5,FALSE),
                   COALESCE($6,TRUE),COALESCE($7,TRUE),COALESCE($8,TRUE),COALESCE($9,TRUE),COALESCE(NOT $10,TRUE))
         ON CONFLICT (user_id) DO UPDATE SET
           mode=EXCLUDED.mode,
           inbound_reach=COALESCE($3::country_inbound_reach,country_discovery_preferences.inbound_reach),
           show_country=COALESCE($4,country_discovery_preferences.show_country),
           show_state=COALESCE($5,country_discovery_preferences.show_state),
           verified_only=COALESCE($6,country_discovery_preferences.verified_only),
           allow_businesses=COALESCE($7,country_discovery_preferences.allow_businesses),
           allow_communities=COALESCE($8,country_discovery_preferences.allow_communities),
           allow_events=COALESCE($9,country_discovery_preferences.allow_events),
           enabled=COALESCE(NOT $10,country_discovery_preferences.enabled), updated_at=now()`,
        [userId, input.mode, input.inboundReach ?? null, input.showCountry ?? null, input.showState ?? null,
          input.verifiedOnly ?? null, input.allowBusinesses ?? null, input.allowCommunities ?? null,
          input.allowEvents ?? null, input.paused ?? null]
      );

      await client.query(`DELETE FROM country_links WHERE user_id = $1`, [userId]);
      for (const code of countries) {
        await client.query(`INSERT INTO country_links (user_id, country_code) VALUES ($1, $2)`, [userId, code]);
      }

      await client.query(`DELETE FROM regional_links WHERE user_id = $1`, [userId]);
      for (const code of regions) {
        await client.query(`INSERT INTO regional_links (user_id, region_code) VALUES ($1, $2)`, [userId, code]);
      }

      if (inboundCountries !== undefined) {
        await client.query(`DELETE FROM country_inbound_links WHERE user_id = $1`, [userId]);
        for (const code of inboundCountries) {
          await client.query(`INSERT INTO country_inbound_links (user_id, country_code) VALUES ($1, $2)`, [userId, code]);
        }
      }
      if (inboundRegions !== undefined) {
        await client.query(`DELETE FROM regional_inbound_links WHERE user_id = $1`, [userId]);
        for (const code of inboundRegions) {
          await client.query(`INSERT INTO regional_inbound_links (user_id, region_code) VALUES ($1, $2)`, [userId, code]);
        }
      }

      await client.query(
        `UPDATE users SET
           location_precision = COALESCE($2, location_precision),
           show_city = CASE
             WHEN COALESCE($2, location_precision) = 'CITY' THEN COALESCE($3, show_city)
             ELSE FALSE
           END
         WHERE id = $1`,
        [userId, input.locationPrecision ?? null, input.showCity ?? null]
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
