const COUNTRY = /^[A-Za-z]{2}$/;
const REGION = /^[A-Za-z0-9-]{1,16}$/;
const TOKEN = /^[\p{L}\p{N} ._+#&/-]{1,60}$/u;

export type DiscoveryFilters = {
  query?: string;
  countries?: string[];
  region?: string;
  /** Matches only people who chose to show their city. */
  city?: string;
  languages?: string[];
  interests?: string[];
  profession?: string;
  verifiedOnly?: boolean;
};

function fail(code: string): never {
  throw Object.assign(new Error(code), { status: 422, code });
}

const unique = <T>(values: T[]) => [...new Set(values)];

/**
 * Normalizes untrusted filters. Filters only ever NARROW a result set: the
 * server's geographic policy is applied separately and a filter can never widen
 * it, so a client cannot inject a country scope through this object.
 */
export function validateFilters(raw: unknown): DiscoveryFilters {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_FILTERS");
  const input = raw as Record<string, unknown>;
  const allowed = new Set(["query", "countries", "region", "city", "languages", "interests", "profession", "verifiedOnly", "onlineOnly"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail("UNKNOWN_FILTER");
  // Presence is not exposed to strangers, so there is no "online now" filter.
  if (input.onlineOnly === true) fail("ONLINE_DISCOVERY_UNAVAILABLE");

  const out: DiscoveryFilters = {};
  if (input.query !== undefined) {
    if (typeof input.query !== "string") fail("INVALID_QUERY");
    const query = input.query.trim().slice(0, 80);
    if (query) out.query = query;
  }
  if (input.countries !== undefined) {
    if (!Array.isArray(input.countries) || input.countries.length > 50) fail("INVALID_COUNTRY_FILTER");
    const countries = unique(input.countries.map((value) => {
      if (typeof value !== "string" || !COUNTRY.test(value)) fail("INVALID_COUNTRY_FILTER");
      return value.toUpperCase();
    }));
    if (countries.length) out.countries = countries;
  }
  if (input.region !== undefined) {
    if (typeof input.region !== "string" || !REGION.test(input.region)) fail("INVALID_REGION_FILTER");
    out.region = input.region.toUpperCase();
  }
  if (input.city !== undefined) {
    if (typeof input.city !== "string") fail("INVALID_CITY_FILTER");
    const city = input.city.trim().slice(0, 80);
    if (city) out.city = city;
  }
  for (const [key, max] of [["languages", 10], ["interests", 20]] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > max) fail(`INVALID_${key.toUpperCase()}_FILTER`);
    const tokens = unique(value.map((item) => {
      if (typeof item !== "string" || !TOKEN.test(item)) fail(`INVALID_${key.toUpperCase()}_FILTER`);
      return item.trim().toLowerCase();
    }));
    if (tokens.length) out[key] = tokens;
  }
  if (input.profession !== undefined) {
    if (typeof input.profession !== "string" || !TOKEN.test(input.profession)) fail("INVALID_PROFESSION_FILTER");
    out.profession = input.profession.trim().toLowerCase();
  }
  if (input.verifiedOnly !== undefined) {
    if (typeof input.verifiedOnly !== "boolean") fail("INVALID_VERIFIED_FILTER");
    out.verifiedOnly = input.verifiedOnly;
  }
  return out;
}

/** Stable text for hashing: key order and array order cannot change the cache key. */
export function canonicalFilters(filters: DiscoveryFilters): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(filters).sort()) {
    const value = (filters as Record<string, unknown>)[key];
    sorted[key] = Array.isArray(value) ? [...value].sort() : value;
  }
  return JSON.stringify(sorted);
}
