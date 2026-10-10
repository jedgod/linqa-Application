import { db } from "../../db/pool.js";
import { countriesForRegion } from "./regionCatalog.js";
import type { EffectiveDiscoveryPolicy } from "./types.js";

export class CountryLinqaPolicyResolver {
  async resolve(userId:string):Promise<EffectiveDiscoveryPolicy> {
    const r = await db.query(`
      SELECT
        u.id,
        u.verified_country_code,
        p.outbound_mode,
        p.inbound_mode,
        p.outbound_country_codes,
        p.inbound_country_codes,
        p.outbound_region_code,
        p.inbound_region_code,
        p.verified_only,
        p.discovery_paused,
        p.allow_businesses,
        p.allow_communities,
        p.allow_events
      FROM users u
      LEFT JOIN country_discovery_policy_v2 p ON p.user_id=u.id
      WHERE u.id=$1
    `,[userId]);

    if (!r.rowCount) throw Object.assign(new Error("USER_NOT_FOUND"),{status:404});

    const x=r.rows[0];
    if (!x.verified_country_code)
      throw Object.assign(new Error("COUNTRY_PROFILE_REQUIRED"),{status:409});

    return {
      viewerUserId:userId,
      viewerCountryCode:x.verified_country_code,
      outboundMode:x.outbound_mode ?? "MY_COUNTRY",
      outboundCountryCodes:x.outbound_country_codes ?? [],
      outboundRegionCode:x.outbound_region_code ?? null,
      inboundMode:x.inbound_mode ?? "MY_COUNTRY",
      inboundCountryCodes:x.inbound_country_codes ?? [],
      inboundRegionCode:x.inbound_region_code ?? null,
      verifiedOnly:x.verified_only ?? true,
      discoveryPaused:x.discovery_paused ?? false,
      allowBusinesses:x.allow_businesses ?? true,
      allowCommunities:x.allow_communities ?? true,
      allowEvents:x.allow_events ?? true
    };
  }

  outboundCountries(p:EffectiveDiscoveryPolicy):string[]|null {
    if (p.outboundMode==="GLOBAL") return null;
    if (p.outboundMode==="MY_COUNTRY") return [p.viewerCountryCode];
    if (p.outboundMode==="SELECTED_COUNTRIES") return p.outboundCountryCodes;
    return countriesForRegion(p.outboundRegionCode);
  }
}
