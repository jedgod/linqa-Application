import type { DiscoveryFilters } from "./types.js";

const COUNTRY=/^[A-Z]{2}$/;
const SAFE_TOKEN=/^[\p{L}\p{N} ._+#&/-]{1,60}$/u;

export function validateFilters(raw:DiscoveryFilters):DiscoveryFilters {
  const out:DiscoveryFilters={};

  if (raw.query) out.query=raw.query.trim().slice(0,80);

  if (raw.countries) {
    out.countries=[...new Set(raw.countries.map(x=>x.toUpperCase()))].slice(0,50);
    if (out.countries.some(x=>!COUNTRY.test(x)))
      throw Object.assign(new Error("INVALID_COUNTRY_FILTER"),{status:422});
  }

  if (raw.languages)
    out.languages=[...new Set(raw.languages.filter(x=>SAFE_TOKEN.test(x)))].slice(0,10);

  if (raw.interests)
    out.interests=[...new Set(raw.interests.filter(x=>SAFE_TOKEN.test(x)))].slice(0,20);

  if (raw.profession) {
    if (!SAFE_TOKEN.test(raw.profession))
      throw Object.assign(new Error("INVALID_PROFESSION_FILTER"),{status:422});
    out.profession=raw.profession;
  }

  if (raw.region) out.region=raw.region.slice(0,20);
  out.verifiedOnly=raw.verifiedOnly ?? false;
  out.onlineOnly=raw.onlineOnly ?? false;
  return out;
}
