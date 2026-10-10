export type Mode="MY_COUNTRY"|"SELECTED_COUNTRIES"|"REGION"|"GLOBAL";
export type InboundMode=Mode|"CONTACTS_ONLY";

export interface RepoNativeDiscoveryPolicy{
  userId:string;
  verifiedCountryCode:string;
  outboundMode:Mode;
  inboundMode:InboundMode;
  selectedCountries:string[];
  regionCode:string|null;
  verifiedOnly:boolean;
  paused:boolean;
  version:number;
}

/**
 * Integrate this resolver with the EXISTING 027 discovery-controls columns.
 * Do not create country_discovery_policy_v2 unless inventory proves 027 lacks
 * the required semantics.
 */
export function normalizePolicy(row:any):RepoNativeDiscoveryPolicy{
  if(!row?.verified_country_code) throw Object.assign(
    new Error("COUNTRY_VERIFICATION_REQUIRED"),{status:409}
  );
  return {
    userId:row.user_id ?? row.id,
    verifiedCountryCode:row.verified_country_code,
    outboundMode:row.visibility_mode ?? row.outbound_mode ?? "MY_COUNTRY",
    inboundMode:row.inbound_mode ?? "MY_COUNTRY",
    selectedCountries:row.selected_countries ?? row.outbound_country_codes ?? [],
    regionCode:row.region_code ?? row.outbound_region_code ?? null,
    verifiedOnly:row.verified_only ?? true,
    paused:row.discovery_paused ?? false,
    version:Number(row.version ?? 1)
  };
}
