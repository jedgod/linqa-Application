import type { PoolClient } from "pg";
import type { Database } from "../db/pool.js";
import type { TrustStatus } from "./home.types.js";

export type PublisherTrustInput = {
  domain: string; displayName: string; countryCode?: string | null; trustStatus: TrustStatus;
  minProviderScore: number; allowBreaking: boolean; allowExternalLinks: boolean;
  attributionRequired: boolean; notes?: string | null;
};

type Queryable = Database | PoolClient;

export class PublisherTrustRepository {
  constructor(private readonly db: Queryable) {}

  async findByDomain(domain: string) {
    const result = await this.db.query(
      `SELECT canonical_domain,display_name,country_code,trust_status,min_provider_score,
        allow_breaking,allow_external_links,attribution_required,notes
       FROM home_news_publishers WHERE canonical_domain=$1`, [domain.toLowerCase()]
    );
    return result.rows[0] ?? null;
  }

  async upsert(input: PublisherTrustInput) {
    await this.db.query(
      `INSERT INTO home_news_publishers
       (canonical_domain,display_name,country_code,trust_status,min_provider_score,allow_breaking,
        allow_external_links,attribution_required,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (canonical_domain) DO UPDATE SET display_name=EXCLUDED.display_name,
        country_code=EXCLUDED.country_code,trust_status=EXCLUDED.trust_status,
        min_provider_score=EXCLUDED.min_provider_score,allow_breaking=EXCLUDED.allow_breaking,
        allow_external_links=EXCLUDED.allow_external_links,attribution_required=EXCLUDED.attribution_required,
        notes=EXCLUDED.notes,updated_at=now()`,
      [input.domain.toLowerCase(), input.displayName, input.countryCode ?? null, input.trustStatus,
       input.minProviderScore, input.allowBreaking, input.allowExternalLinks, input.attributionRequired,
       input.notes ?? null]
    );
  }

  async list(limit = 200) {
    const result = await this.db.query(`SELECT * FROM home_news_publishers ORDER BY display_name ASC LIMIT $1`, [limit]);
    return result.rows;
  }
}
