import type { Database } from "../db/pool.js";
import { homeProductionConfig } from "../config/home-production.config.js";
import type { HomeNewsItem } from "./home.types.js";

export interface StoredNewsRow {
  id: string;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  imageUrl: string | null;
  publisherDomain: string;
  publisherName: string;
  providerName: string;
  category: string;
  countryCode: string | null;
  publishedAt: string;
  breaking: boolean;
  attributionRequired: boolean;
  trustStatus: string;
}

const STORED_NEWS_COLUMNS = `
  id,
  title,
  summary,
  canonical_url AS "canonicalUrl",
  image_url AS "imageUrl",
  publisher_domain AS "publisherDomain",
  publisher_name AS "publisherName",
  provider_name AS "providerName",
  category,
  country_code AS "countryCode",
  published_at AS "publishedAt",
  (breaking_until IS NOT NULL AND breaking_until > now()) AS breaking,
  COALESCE((metadata->>'attributionRequired')::boolean, TRUE) AS "attributionRequired",
  COALESCE(metadata->>'publisherTrustStatus', 'UNKNOWN') AS "trustStatus"
`;

export class HomeRepository {
  constructor(private readonly db: Database) {}

  async saveSnapshot(input: {
    userId: string;
    country: string;
    payload: unknown;
    hash: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO home_feed_snapshots (user_id,jurisdiction_country,payload,payload_hash,expires_at)
       VALUES ($1,$2,$3::jsonb,$4,now()+make_interval(secs=>$5))`,
      [input.userId, input.country, JSON.stringify(input.payload), input.hash, input.ttlSeconds]
    );
  }

  async getLatestSnapshot(userId: string): Promise<{ payload: unknown; generated_at: string } | null> {
    const result = await this.db.query(
      `SELECT payload,generated_at,expires_at FROM home_feed_snapshots
       WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 1`,
      [userId]
    );
    return (result.rows[0] as { payload: unknown; generated_at: string } | undefined) ?? null;
  }

  async pruneSnapshots(retentionDays = homeProductionConfig.feed.snapshotRetentionDays): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM home_feed_snapshots WHERE generated_at < now() - make_interval(days=>$1)`,
      [retentionDays]
    );
    return result.rowCount ?? 0;
  }

  async saveArticle(article: HomeNewsItem): Promise<void> {
    // A publisher cleared for breaking coverage gets a bounded BREAKING
    // window measured from publication, not from ingestion, so a late-arriving
    // story cannot present as newer than it is. `expire-breaking-news` flips
    // lifecycle_state once the window closes.
    const breakingUntil = article.breakingEligible
      ? new Date(
          Date.parse(article.publishedAt) + homeProductionConfig.news.breakingWindowMinutes * 60_000
        ).toISOString()
      : null;

    const metadata = {
      ...(article.metadata ?? {}),
      publisherTrustStatus: article.publisherTrustStatus,
      attributionRequired: article.attributionRequired,
      breakingEligible: article.breakingEligible,
      sourceUrl: article.url
    };

    await this.db.query(
      `INSERT INTO home_news_articles
       (canonical_url,url_hash,title,summary,image_url,publisher_domain,publisher_name,provider_name,
        provider_article_id,category,country_code,source_language,published_at,lifecycle_state,
        breaking_until,content_fingerprint,provider_score,validation_score,trust_score,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PUBLISHED',$14,$15,$16,$17,$18,$19::jsonb)
       ON CONFLICT (canonical_url) DO UPDATE SET
        title=EXCLUDED.title,
        summary=EXCLUDED.summary,
        image_url=EXCLUDED.image_url,
        category=EXCLUDED.category,
        country_code=EXCLUDED.country_code,
        provider_score=EXCLUDED.provider_score,
        validation_score=EXCLUDED.validation_score,
        trust_score=EXCLUDED.trust_score,
        metadata=EXCLUDED.metadata,
        breaking_until=EXCLUDED.breaking_until,
        last_seen_at=now(),
        -- Reaching this insert means the article passed validation and
        -- publisher trust *now*, so a stale EXPIRED (aged out) or REJECTED
        -- (publisher was blocked, since re-approved) state is revived rather
        -- than pinning the article out of the feed permanently.
        lifecycle_state=CASE WHEN home_news_articles.title<>EXCLUDED.title THEN 'UPDATED'
          WHEN home_news_articles.lifecycle_state IN ('EXPIRED','REJECTED') THEN 'PUBLISHED'
          ELSE home_news_articles.lifecycle_state END,
        updated_at=now()`,
      [
        article.canonicalUrl,
        article.urlHash,
        article.title,
        article.summary ?? null,
        article.imageUrl ?? null,
        article.publisherDomain,
        article.publisherName,
        article.providerName,
        article.providerArticleId ?? null,
        article.category,
        article.countryCode ?? null,
        article.sourceLanguage ?? null,
        article.publishedAt,
        breakingUntil,
        article.contentFingerprint,
        article.providerScore,
        article.validationScore,
        article.trustScore,
        JSON.stringify(metadata)
      ]
    );
  }

  /**
   * Durable-store read used by the World News screen and by Home's Live
   * Updates / Spotlight sections. Reads only PUBLISHED-family states so a
   * rejected or expired article can never resurface.
   */
  async listArticles(filter: {
    category?: string | undefined;
    countryCode?: string | undefined;
    breakingOnly?: boolean | undefined;
    withImageOnly?: boolean | undefined;
    sinceHours?: number | undefined;
    limit: number;
    offset?: number | undefined;
  }): Promise<StoredNewsRow[]> {
    const conditions = [`lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED')`];
    const params: unknown[] = [];

    if (filter.category) {
      params.push(filter.category.toUpperCase());
      conditions.push(`category = $${params.length}`);
    }
    if (filter.countryCode) {
      params.push(filter.countryCode.toUpperCase());
      conditions.push(`country_code = $${params.length}`);
    }
    if (filter.breakingOnly) {
      conditions.push(`breaking_until IS NOT NULL AND breaking_until > now()`);
    }
    if (filter.withImageOnly) {
      conditions.push(`image_url IS NOT NULL`);
    }
    if (filter.sinceHours !== undefined) {
      params.push(filter.sinceHours);
      conditions.push(`published_at > now() - make_interval(hours => $${params.length})`);
    }

    params.push(Math.max(1, Math.min(filter.limit, 100)));
    const limitPlaceholder = `$${params.length}`;
    params.push(Math.max(0, filter.offset ?? 0));
    const offsetPlaceholder = `$${params.length}`;

    const result = await this.db.query(
      `SELECT ${STORED_NEWS_COLUMNS}
       FROM home_news_articles
       WHERE ${conditions.join(" AND ")}
       ORDER BY published_at DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    );
    return result.rows as StoredNewsRow[];
  }

  async countArticles(filter: { category?: string | undefined; countryCode?: string | undefined }): Promise<number> {
    const conditions = [`lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED')`];
    const params: unknown[] = [];
    if (filter.category) {
      params.push(filter.category.toUpperCase());
      conditions.push(`category = $${params.length}`);
    }
    if (filter.countryCode) {
      params.push(filter.countryCode.toUpperCase());
      conditions.push(`country_code = $${params.length}`);
    }
    const result = await this.db.query(
      `SELECT count(*)::int AS total FROM home_news_articles WHERE ${conditions.join(" AND ")}`,
      params
    );
    return Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0);
  }

  /** Live category counts, used for the CountryLinqa "trending" rail. */
  async categoryTrends(sinceHours: number, limit: number): Promise<Array<{ category: string; storyCount: number }>> {
    const result = await this.db.query(
      `SELECT category, count(*)::int AS "storyCount"
       FROM home_news_articles
       WHERE lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED')
         AND published_at > now() - make_interval(hours => $1)
       GROUP BY category
       ORDER BY count(*) DESC, category ASC
       LIMIT $2`,
      [sinceHours, Math.max(1, Math.min(limit, 20))]
    );
    return result.rows as Array<{ category: string; storyCount: number }>;
  }

  /**
   * Drops the BREAKING treatment once a story's window closes.
   *
   * The closure pack's job set `lifecycle_state='EXPIRED'` here. That is too
   * strong: EXPIRED removes the article from `listArticles()` entirely, so
   * every breaking-cleared story would vanish from World News 90 minutes
   * after publication while un-cleared stories stayed forever. A story
   * stopping being *breaking* is not the story becoming invalid, so the
   * window closing clears `breaking_until` and article expiry is handled
   * separately by age.
   */
  async demoteExpiredBreaking(): Promise<number> {
    const result = await this.db.query(
      `UPDATE home_news_articles
       SET breaking_until=NULL, updated_at=now()
       WHERE breaking_until IS NOT NULL
         AND breaking_until <= now()
         AND lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED')`
    );
    return result.rowCount ?? 0;
  }

  /** Retires articles that are simply too old to present as current news. */
  async expireStaleArticles(maxAgeDays: number): Promise<number> {
    const result = await this.db.query(
      `UPDATE home_news_articles
       SET lifecycle_state='EXPIRED', breaking_until=NULL, updated_at=now()
       WHERE lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED')
         AND published_at < now() - make_interval(days => $1)`,
      [Math.max(1, maxAgeDays)]
    );
    return result.rowCount ?? 0;
  }
}
