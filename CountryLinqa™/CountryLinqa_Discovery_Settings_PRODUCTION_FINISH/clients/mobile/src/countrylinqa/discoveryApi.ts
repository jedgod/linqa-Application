export type DiscoveryPolicy = {
  outboundMode:"MY_COUNTRY"|"SELECTED_COUNTRIES"|"REGION"|"GLOBAL";
  inboundMode:"MY_COUNTRY"|"SELECTED_COUNTRIES"|"REGION"|"GLOBAL"|"CONTACTS_ONLY";
  outboundCountryCodes:string[];
  inboundCountryCodes:string[];
  outboundRegionCode:string|null;
  inboundRegionCode:string|null;
  showCountry:boolean;
  showState:boolean;
  showCity:boolean;
  verifiedOnly:boolean;
  allowBusinesses:boolean;
  allowCommunities:boolean;
  allowEvents:boolean;
  discoveryPaused:boolean;
  version:number;
};

export async function getDiscoveryPolicy(api:any):Promise<DiscoveryPolicy> {
  return api.get("/v1/countrylinqa/preferences");
}

export async function saveDiscoveryPolicy(api:any, policy:DiscoveryPolicy) {
  try {
    return await api.put("/v1/countrylinqa/preferences", policy);
  } catch (e:any) {
    if (e?.status === 409) {
      throw new Error("Your settings changed on another device. Reload and try again.");
    }
    if (e?.code === "PREMIUM_REQUIRED" || e?.code === "ELITE_REQUIRED") {
      throw new Error("Your current plan does not allow this discovery scope.");
    }
    throw e;
  }
}
