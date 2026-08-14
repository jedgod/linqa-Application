import { describe, expect, it, vi } from "vitest";
import { assertEntitled } from "../services/countrylinqa/entitlements.js";
import { evaluateCountryRisk } from "../services/countrylinqa/risk.js";
import { CountryLinqaService } from "../services/countrylinqa/service.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import type { SubscriptionProvider } from "../services/countrylinqa/entitlements.js";
import type { PhoneEvidenceProvider } from "../services/countrylinqa/providers.js";
import type { GeoIpProvider } from "../services/countrylinqa/providers.js";

/**
 * Real tests against the ALREADY-EXISTING CountryLinqa implementation
 * (server/src/services/countrylinqa/*), replacing the pack's `it.todo()`
 * placeholders with assertions against real invariants — the entitlement
 * tiers, the risk-scoring thresholds, and the service's transactional
 * preference-saving/country-confirmation flows — using the same
 * mocked-`Database` pattern already established in file-vault.test.ts.
 */
const config = { COUNTRY_SELECTION_PREMIUM_LIMIT: 5 } as AppConfig;

describe("CountryLinqa entitlements invariants", () => {
  it("FREE tier is confined to MY_COUNTRY with no extra countries/regions", () => {
    expect(() => assertEntitled("FREE", "MY_COUNTRY", 0, 0, config)).not.toThrow();
    expect(() => assertEntitled("FREE", "SELECTED_COUNTRIES", 1, 0, config)).toThrow(/Upgrade required/);
    expect(() => assertEntitled("FREE", "GLOBAL", 0, 0, config)).toThrow(/Upgrade required/);
  });

  it("PREMIUM tier cannot reach GLOBAL and is bounded by configured limits", () => {
    expect(() => assertEntitled("PREMIUM", "GLOBAL", 0, 0, config)).toThrow(/Upgrade required/);
    expect(() => assertEntitled("PREMIUM", "SELECTED_COUNTRIES", 5, 0, config)).not.toThrow();
    expect(() => assertEntitled("PREMIUM", "SELECTED_COUNTRIES", 6, 0, config)).toThrow(/limit exceeded/);
    expect(() => assertEntitled("PREMIUM", "REGION", 0, 11, config)).toThrow(/Region selection limit/);
  });

  it("ELITE tier has no restrictions modeled here, including GLOBAL", () => {
    expect(() => assertEntitled("ELITE", "GLOBAL", 999, 999, config)).not.toThrow();
  });
});

describe("CountryLinqa risk-scoring invariants", () => {
  it("an unverified phone number alone already crosses into REVIEW_REQUIRED (score 50)", () => {
    const result = evaluateCountryRisk({ phoneVerified: false });
    expect(result.score).toBe(50);
    expect(result.state).toBe("REVIEW_REQUIRED");
    expect(result.reasons).toContain("PHONE_NOT_VERIFIED");
  });

  it("a verified phone with no mismatches is VERIFIED with score 0", () => {
    const result = evaluateCountryRisk({ phoneVerified: true, phoneCountryCode: "US", claimedCountryCode: "US" });
    expect(result.state).toBe("VERIFIED");
    expect(result.score).toBe(0);
  });

  it("a disposable/VOIP line type alone crosses the REVIEW_REQUIRED threshold", () => {
    const result = evaluateCountryRisk({ phoneVerified: true, lineType: "VOIP" });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.state).toBe("REVIEW_REQUIRED");
  });

  it("stacking every mismatch signal crosses the RESTRICTED threshold and caps at 100", () => {
    const result = evaluateCountryRisk({
      phoneVerified: false,
      lineType: "DISPOSABLE",
      phoneCountryCode: "US",
      claimedCountryCode: "NG",
      carrierCountryCode: "GB",
      simCountryCode: "FR",
      ipCountryCode: "DE",
      localeCountryCode: "JP"
    });
    expect(result.state).toBe("RESTRICTED");
    expect(result.score).toBe(100);
  });
});

function makeService(overrides: {
  query?: ReturnType<typeof vi.fn>;
  connect?: ReturnType<typeof vi.fn>;
  subscriptions?: SubscriptionProvider;
  phoneEvidence?: PhoneEvidenceProvider;
  geoIp?: GeoIpProvider;
}) {
  const db = { query: overrides.query ?? vi.fn(async () => ({ rows: [], rowCount: 0 })), connect: overrides.connect } as unknown as Database;
  const subscriptions = overrides.subscriptions ?? { getTier: vi.fn(async () => "FREE" as const) };
  const phoneEvidence =
    overrides.phoneEvidence ??
    ({ getEvidenceForUser: vi.fn(async () => ({ phoneCountryCode: "US", phoneVerified: true })) } as PhoneEvidenceProvider);
  const geoIp = overrides.geoIp ?? ({ resolveCountry: vi.fn(async () => undefined) } as GeoIpProvider);
  return new CountryLinqaService(db, config, subscriptions, phoneEvidence, geoIp);
}

describe("CountryLinqaService.savePreferences invariants", () => {
  it("rejects SELECTED_COUNTRIES mode with zero countries before touching the database", async () => {
    const query = vi.fn();
    const service = makeService({ query, subscriptions: { getTier: vi.fn(async () => "PREMIUM" as const) } });
    await expect(
      service.savePreferences("user-1", {
        mode: "SELECTED_COUNTRIES",
        selectedCountries: [],
        selectedRegions: [],
        locationPrecision: "COUNTRY",
        showCity: false
      })
    ).rejects.toMatchObject({ code: "COUNTRY_REQUIRED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects REGION mode with zero regions before touching the database", async () => {
    const query = vi.fn();
    const service = makeService({ query, subscriptions: { getTier: vi.fn(async () => "PREMIUM" as const) } });
    await expect(
      service.savePreferences("user-1", {
        mode: "REGION",
        selectedCountries: [],
        selectedRegions: [],
        locationPrecision: "COUNTRY",
        showCity: false
      })
    ).rejects.toMatchObject({ code: "REGION_REQUIRED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("enforces entitlement limits before any transaction is opened", async () => {
    const connect = vi.fn();
    const service = makeService({
      connect,
      subscriptions: { getTier: vi.fn(async () => "FREE" as const) }
    });
    await expect(
      service.savePreferences("user-1", {
        mode: "GLOBAL",
        selectedCountries: [],
        selectedRegions: [],
        locationPrecision: "COUNTRY",
        showCity: false
      })
    ).rejects.toThrow(/Upgrade required/);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("CountryLinqaService.confirmCountry invariants", () => {
  it("routes a high-risk mismatch to REVIEW_REQUIRED/RESTRICTED and records a risk event", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 1 };
      })
    };
    const connect = vi.fn(async () => ({ ...client, release: vi.fn() }));
    const service = makeService({
      connect,
      phoneEvidence: {
        getEvidenceForUser: vi.fn(async () => ({ phoneCountryCode: "US", phoneVerified: false, lineType: "VOIP" }))
      } as PhoneEvidenceProvider
    });

    const result = await service.confirmCountry("user-1", { claimedCountryCode: "NG" }, "203.0.113.1");

    expect(result.reviewRequired).toBe(true);
    expect(queries.some((q) => q.includes("INSERT INTO country_risk_events"))).toBe(true);
    expect(queries.some((q) => q.includes("COMMIT"))).toBe(true);
  });

  it("a clean, verified, matching phone does not require review", async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    const connect = vi.fn(async () => ({ ...client, release: vi.fn() }));
    const service = makeService({
      connect,
      phoneEvidence: {
        getEvidenceForUser: vi.fn(async () => ({ phoneCountryCode: "US", phoneVerified: true }))
      } as PhoneEvidenceProvider
    });

    const result = await service.confirmCountry("user-1", { claimedCountryCode: "US" }, "203.0.113.1");
    expect(result.reviewRequired).toBe(false);
    expect(result.verificationState).toBe("VERIFIED");
  });
});

describe("CountryLinqa country clarification invariants", () => {
  it("records review without replacing verified-country evidence", async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: sql.includes("SELECT 1 FROM countries") ? 1 : 1 };
    });
    const service = makeService({
      query,
      phoneEvidence: { getEvidenceForUser: vi.fn(async () => ({ phoneCountryCode: "US", phoneVerified: true })) } as PhoneEvidenceProvider
    });
    const result = await service.requestCountryClarification("user-1", "GB");
    expect(result).toMatchObject({ reviewRequired: true, detectedCountryCode: "US", proposedCountryCode: "GB" });
    expect(queries.some((sql) => sql.includes("COUNTRY_CLARIFICATION_REQUESTED"))).toBe(true);
    expect(queries.some((sql) => sql.includes("verified_country_code IS NULL"))).toBe(true);
    expect(queries.some((sql) => sql.includes("SET verified_country_code"))).toBe(false);
  });
});
