import type { EffectiveDiscoveryPolicy } from "./types.js";
import { countriesForRegion } from "./regionCatalog.js";

export function outboundCountryScope(policy:EffectiveDiscoveryPolicy) {
  if (policy.outboundMode==="GLOBAL") return null;
  if (policy.outboundMode==="MY_COUNTRY") return [policy.viewerCountryCode];
  if (policy.outboundMode==="SELECTED_COUNTRIES") return policy.outboundCountryCodes;
  return countriesForRegion(policy.outboundRegionCode);
}

export function appendCountryPredicate(
  params:any[],
  countryColumn:string,
  countries:string[]|null
) {
  if (countries===null) return {sql:"",params};
  params.push(countries);
  return {
    sql:` AND ${countryColumn} = ANY($${params.length}::text[]) `,
    params
  };
}
