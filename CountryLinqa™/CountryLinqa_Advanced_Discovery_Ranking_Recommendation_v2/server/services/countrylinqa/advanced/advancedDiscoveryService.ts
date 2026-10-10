import { db } from "../../../db/pool.js";
import { CountryLinqaPolicyResolver } from "../policyResolver.js";
import { canExposePerson } from "../eligibility.js";
import { validateFilters } from "./filterValidator.js";
import { rankAndDiversify } from "./ranker.js";
import { encodeCursor } from "./cursor.js";

export class AdvancedDiscoveryService {
  private policyResolver=new CountryLinqaPolicyResolver();

  async people(input:{
    userId:string;
    filters:any;
    limit:number;
  }) {
    const started=Date.now();
    const filters=validateFilters(input.filters);
    const policy=await this.policyResolver.resolve(input.userId);

    const viewerFeatureResult=await db.query(`
      SELECT
        u.id,
        u.verified_country_code,
        COALESCE(f.languages,'{}') languages,
        COALESCE(f.interests,'{}') interests,
        f.profession_code
      FROM users u
      LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id=u.id
      WHERE u.id=$1
    `,[input.userId]);

    const viewerRow=viewerFeatureResult.rows[0];
    const viewer={
      userId:input.userId,
      countryCode:viewerRow.verified_country_code,
      languages:viewerRow.languages,
      interests:viewerRow.interests,
      professionCode:viewerRow.profession_code
    };

    // Fetch an oversampled pool. For very large installations, push more
    // eligibility predicates into SQL and/or a search index before ranking.
    const pool=await db.query(`
      SELECT
        u.id user_id,
        u.verified_country_code country_code,
        COALESCE(u.identity_verified,FALSE) verified,
        COALESCE(f.languages,'{}') languages,
        COALESCE(f.interests,'{}') interests,
        f.profession_code,
        f.last_active_at,
        COALESCE(p.inbound_mode,'MY_COUNTRY') inbound_mode,
        COALESCE(p.inbound_country_codes,'{}') inbound_country_codes,
        p.inbound_region_code,
        COALESCE(p.discovery_paused,FALSE) discovery_paused,
        COALESCE(pc.profile_quality,0.5) profile_quality,
        COALESCE(pc.safety_quality,0.5) safety_quality,
        CASE WHEN f.last_active_at > now()-interval '24 hours' THEN 1.0 ELSE 0.3 END freshness,
        (
          SELECT COUNT(*)::int FROM contacts a
          JOIN contacts b ON b.contact_user_id=a.contact_user_id
          WHERE a.owner_user_id=$1 AND b.owner_user_id=u.id
        ) mutual_connections,
        EXISTS(
          SELECT 1 FROM contacts c
          WHERE c.owner_user_id=$1 AND c.contact_user_id=u.id
        ) existing_contact,
        EXISTS(
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id)
             OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1)
        ) blocked
      FROM users u
      LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id=u.id
      LEFT JOIN country_discovery_policy_v2 p ON p.user_id=u.id
      LEFT JOIN user_profile_quality pc ON pc.user_id=u.id
      WHERE u.id<>$1
      LIMIT 500
    `,[input.userId]);

    const eligible=pool.rows.filter((r:any)=>{
      if (filters.verifiedOnly && !r.verified) return false;
      if (filters.onlineOnly && (!r.last_active_at ||
          Date.now()-new Date(r.last_active_at).getTime()>15*60*1000)) return false;
      if (filters.languages?.length &&
          !filters.languages.some((x:string)=>r.languages.includes(x))) return false;
      if (filters.interests?.length &&
          !filters.interests.some((x:string)=>r.interests.includes(x))) return false;
      if (filters.profession && r.profession_code!==filters.profession) return false;

      return canExposePerson({
        viewer:policy,
        candidate:{
          userId:r.user_id,
          verifiedCountryCode:r.country_code,
          verified:r.verified,
          inboundMode:r.inbound_mode,
          inboundCountryCodes:r.inbound_country_codes,
          inboundRegionCode:r.inbound_region_code,
          discoveryPaused:r.discovery_paused
        },
        isExistingContact:r.existing_contact,
        isBlocked:r.blocked
      });
    });

    const ranked=rankAndDiversify(viewer,eligible.map((r:any)=>({
      userId:r.user_id,
      countryCode:r.country_code,
      verified:r.verified,
      languages:r.languages,
      interests:r.interests,
      professionCode:r.profession_code,
      lastActiveAt:r.last_active_at,
      mutualConnections:r.mutual_connections,
      profileQuality:Number(r.profile_quality),
      safetyQuality:Number(r.safety_quality),
      freshness:Number(r.freshness)
    })),Math.min(input.limit,50));

    const last=ranked.at(-1);
    return {
      items:ranked.map(({score,...x})=>({...x,rankingScore:score})),
      nextCursor:last ? encodeCursor({
        lastScore:last.score,
        lastUserId:last.userId,
        policyVersion:(policy as any).version ?? 1,
        issuedAt:Date.now()
      }) : null,
      meta:{latencyMs:Date.now()-started}
    };
  }
}
