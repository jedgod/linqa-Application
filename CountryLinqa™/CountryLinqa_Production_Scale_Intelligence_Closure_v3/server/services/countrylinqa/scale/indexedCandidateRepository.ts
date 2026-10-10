import { db } from "../../../db/pool.js";

export type CandidateQuery={
  viewerUserId:string;
  countryScope:string[]|null;
  languages:string[];
  interests:string[];
  profession?:string;
  verifiedOnly:boolean;
  onlineOnly:boolean;
  afterUserId?:string;
  limit:number;
};

export class IndexedCandidateRepository {
  async fetch(q:CandidateQuery) {
    const p:any[]=[q.viewerUserId];
    const where:string[]=["u.id <> $1","COALESCE(f.discoverable,TRUE)=TRUE"];

    if (q.countryScope) {
      p.push(q.countryScope);
      where.push(`u.verified_country_code = ANY($${p.length}::text[])`);
    }
    if (q.profession) {
      p.push(q.profession);
      where.push(`f.profession_code=$${p.length}`);
    }
    if (q.verifiedOnly) where.push("COALESCE(u.identity_verified,FALSE)=TRUE");
    if (q.onlineOnly) where.push("f.last_active_at > now()-interval '15 minutes'");
    if (q.languages.length) {
      p.push(q.languages);
      where.push(`f.languages && $${p.length}::text[]`);
    }
    if (q.interests.length) {
      p.push(q.interests);
      where.push(`f.interests && $${p.length}::text[]`);
    }
    if (q.afterUserId) {
      p.push(q.afterUserId);
      where.push(`u.id > $${p.length}::uuid`);
    }

    p.push(Math.min(Math.max(q.limit,1),250));

    return (await db.query(`
      SELECT
        u.id user_id,
        u.verified_country_code country_code,
        COALESCE(u.identity_verified,FALSE) verified,
        COALESCE(f.languages,'{}') languages,
        COALESCE(f.interests,'{}') interests,
        f.profession_code,
        f.last_active_at,
        COALESCE(dp.inbound_mode,'MY_COUNTRY') inbound_mode,
        COALESCE(dp.inbound_country_codes,'{}') inbound_country_codes,
        dp.inbound_region_code,
        COALESCE(dp.discovery_paused,FALSE) discovery_paused
      FROM users u
      LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id=u.id
      LEFT JOIN country_discovery_policy_v2 dp ON dp.user_id=u.id
      WHERE ${where.join(" AND ")}
      ORDER BY u.id
      LIMIT $${p.length}
    `,p)).rows;
  }
}
