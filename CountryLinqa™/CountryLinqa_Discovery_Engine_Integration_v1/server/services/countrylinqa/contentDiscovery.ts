import { db } from "../../db/pool.js";
import { CountryLinqaPolicyResolver } from "./policyResolver.js";
import { appendCountryPredicate } from "./sqlScope.js";

export class CountryContentDiscoveryService {
  private resolver=new CountryLinqaPolicyResolver();

  async posts(userId:string,limit=30) {
    const p=await this.resolver.resolve(userId);
    const scope=this.resolver.outboundCountries(p);
    let params:any[]=[userId];
    const country=appendCountryPredicate(params,"posts.country_code",scope);
    params=country.params;
    params.push(limit);

    return db.query(`
      SELECT posts.*
      FROM country_posts posts
      WHERE posts.status='PUBLISHED'
        ${country.sql}
        AND NOT EXISTS(
          SELECT 1 FROM user_blocks b
          WHERE b.blocker_user_id=$1 AND b.blocked_user_id=posts.author_user_id
        )
      ORDER BY posts.created_at DESC
      LIMIT $${params.length}
    `,params);
  }

  async events(userId:string,limit=30) {
    const p=await this.resolver.resolve(userId);
    if (!p.allowEvents) return {rows:[]};
    const scope=this.resolver.outboundCountries(p);
    let params:any[]=[];
    const country=appendCountryPredicate(params,"e.country_code",scope);
    params=country.params;
    params.push(limit);
    return db.query(`
      SELECT e.* FROM events e
      WHERE e.visibility='PUBLIC' ${country.sql}
      ORDER BY e.starts_at ASC
      LIMIT $${params.length}
    `,params);
  }

  async businesses(userId:string,limit=30) {
    const p=await this.resolver.resolve(userId);
    if (!p.allowBusinesses) return {rows:[]};
    const scope=this.resolver.outboundCountries(p);
    let params:any[]=[];
    const country=appendCountryPredicate(params,"b.country_code",scope);
    params=country.params;
    params.push(limit);
    return db.query(`
      SELECT b.* FROM businesses b
      WHERE b.status='ACTIVE' ${country.sql}
      ORDER BY b.discovery_score DESC
      LIMIT $${params.length}
    `,params);
  }

  async communities(userId:string,limit=30) {
    const p=await this.resolver.resolve(userId);
    if (!p.allowCommunities) return {rows:[]};
    const scope=this.resolver.outboundCountries(p);
    let params:any[]=[];
    const country=appendCountryPredicate(params,"c.country_code",scope);
    params=country.params;
    params.push(limit);
    return db.query(`
      SELECT c.* FROM communities c
      WHERE c.status='ACTIVE' ${country.sql}
      ORDER BY c.member_count DESC
      LIMIT $${params.length}
    `,params);
  }
}
