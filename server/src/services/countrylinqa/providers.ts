import type { Database } from "../../db/pool.js";

export type PhoneEvidence = {
  phoneCountryCode: string;
  carrierCountryCode?: string;
  lineType?: string;
  carrierName?: string;
  phoneVerified: boolean;
};

export interface PhoneEvidenceProvider {
  getEvidenceForUser(userId: string): Promise<PhoneEvidence>;
}

/**
 * Real implementation, reading the same `phone_identities_v2` table the
 * live multi-account phone-verification vertical (migration 019,
 * PhoneRegistrationService) already writes — not the pack's
 * StubPhoneEvidenceProvider, which always threw "not configured".
 */
export class DatabasePhoneEvidenceProvider implements PhoneEvidenceProvider {
  constructor(private readonly db: Database) {}

  async getEvidenceForUser(userId: string): Promise<PhoneEvidence> {
    const result = await this.db.query(
      `SELECT country_iso2, carrier_country, line_type, carrier_name, verification_state
       FROM phone_identities_v2
       WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      const error: any = new Error("No verified phone number on this account.");
      error.status = 422;
      error.code = "PHONE_NOT_VERIFIED";
      throw error;
    }
    return {
      phoneCountryCode: row.country_iso2,
      carrierCountryCode: row.carrier_country ?? undefined,
      lineType: row.line_type ?? undefined,
      carrierName: row.carrier_name ?? undefined,
      phoneVerified: row.verification_state === "VERIFIED_MOBILE"
    };
  }
}

export interface GeoIpProvider {
  resolveCountry(ip: string): Promise<string | undefined>;
}

/** No real IP-geolocation provider is configured; fails closed (undefined),
 * matching every other unconfigured provider in the real system. */
export class NoopGeoIpProvider implements GeoIpProvider {
  async resolveCountry(_ip: string): Promise<string | undefined> {
    return undefined;
  }
}

/** HTTP adapter for a deployment-owned GeoIP service. It fails closed on
 * transport, response, or schema errors so country evidence is never guessed. */
export class HttpGeoIpProvider implements GeoIpProvider {
  constructor(private readonly endpoint: string, private readonly token?: string) {}

  async resolveCountry(ip: string): Promise<string> {
    const url = new URL(this.endpoint);
    url.searchParams.set("ip", ip);
    const init: RequestInit = { signal: AbortSignal.timeout(5_000) };
    if (this.token) init.headers = { authorization: `Bearer ${this.token}` };
    const response = await fetch(url, init);
    if (!response.ok) throw new Error("GeoIP provider unavailable");
    const body = await response.json() as { countryCode?: unknown };
    if (typeof body.countryCode !== "string" || !/^[A-Za-z]{2}$/.test(body.countryCode)) {
      throw new Error("GeoIP provider returned an invalid country code");
    }
    return body.countryCode.toUpperCase();
  }
}
