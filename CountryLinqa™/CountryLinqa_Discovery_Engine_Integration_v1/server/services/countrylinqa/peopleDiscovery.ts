import { db } from "../../db/pool.js";
import { CountryLinqaPolicyResolver } from "./policyResolver.js";
import { canExposePerson } from "./eligibility.js";

export class PeopleDiscoveryService {
  private resolver=new CountryLinqaPolicyResolver();

  async list(viewerUserId:string,limit=30,cursor?:string) {
    const policy=await this.resolver.resolve(viewerUserId);

    const rows=await db.query(`
      SELECT
        u.id AS user_id,
        u.display_name,
        u.verified_country_code,
        COALESCE(u.identity_verified,FALSE) AS verified,
        COALESCE(p.inbound_mode,'MY_COUNTRY') AS inbound_mode,
        COALESCE(p.inbound_country_codes,'{}') AS inbound_country_codes,
        p.inbound_region_code,
        COALESCE(p.discovery_paused,FALSE) AS discovery_paused,
        EXISTS(
          SELECT 1 FROM contacts c
          WHERE c.owner_user_id=$1 AND c.contact_user_id=u.id
        ) AS existing_contact,
        EXISTS(
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id)
             OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1)
        ) AS blocked
      FROM users u
      LEFT JOIN country_discovery_policy_v2 p ON p.user_id=u.id
      WHERE u.id<>$1
      ORDER BY u.id
      LIMIT $2
    `,[viewerUserId,Math.min(limit*4,120)]);

    const visible=rows.rows.filter((r:any)=>canExposePerson({
      viewer:policy,
      candidate:{
        userId:r.user_id,
        verifiedCountryCode:r.verified_country_code,
        verified:r.verified,
        inboundMode:r.inbound_mode,
        inboundCountryCodes:r.inbound_country_codes,
        inboundRegionCode:r.inbound_region_code,
        discoveryPaused:r.discovery_paused
      },
      isExistingContact:r.existing_contact,
      isBlocked:r.blocked
    })).slice(0,limit);

    return {
      items:visible,
      nextCursor:visible.length===limit ? visible.at(-1)?.user_id : null
    };
  }
}
