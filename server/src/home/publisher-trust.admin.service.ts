import type { Database } from "../db/pool.js";
import { PublisherTrustRepository, type PublisherTrustInput } from "./publisher-trust.repository.js";

export interface PublisherTrustWriteContext {
  actorUserId: string;
  actorScopes: string[];
  requestId?: string | undefined;
  reasonCode: string;
}

/**
 * Publisher-trust writes with the audit trail the pack requires ("all writes
 * should produce an audit event and outbox event").
 *
 * The upsert, the `ops_audit_events` row and the `ops_outbox` row are written
 * in one transaction: a trust change that reached the feed without a
 * corresponding audit record would be unexplainable afterwards, which is
 * exactly the situation an allowlist exists to prevent.
 */
export class PublisherTrustAdminService {
  constructor(private readonly db: Database) {}

  async upsert(input: PublisherTrustInput, context: PublisherTrustWriteContext): Promise<Record<string, unknown>> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const repository = new PublisherTrustRepository(client);

      const before = await repository.findByDomain(input.domain);
      await repository.upsert(input);
      const after = await repository.findByDomain(input.domain);

      await client.query(
        `INSERT INTO ops_audit_events
           (actor_user_id, actor_scope_snapshot, action, resource_type, resource_id,
            reason_code, request_id, before_json, after_json)
         VALUES ($1,$2::jsonb,'home.publisher.trust.upsert','home_news_publisher',$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          context.actorUserId,
          JSON.stringify(context.actorScopes),
          input.domain.toLowerCase(),
          context.reasonCode,
          context.requestId ?? null,
          JSON.stringify(before),
          JSON.stringify(after)
        ]
      );

      await client.query(
        `INSERT INTO ops_outbox (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('home_news_publisher',$1,'home.publisher.trust.changed',$2::jsonb)`,
        [
          input.domain.toLowerCase(),
          JSON.stringify({
            domain: input.domain.toLowerCase(),
            trustStatus: input.trustStatus,
            previousTrustStatus: (before as { trust_status?: string } | null)?.trust_status ?? null,
            allowExternalLinks: input.allowExternalLinks,
            allowBreaking: input.allowBreaking,
            minProviderScore: input.minProviderScore,
            actorUserId: context.actorUserId,
            reasonCode: context.reasonCode
          })
        ]
      );

      await client.query("COMMIT");
      return (after ?? {}) as Record<string, unknown>;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Blocking a publisher must also drop what it already put in front of
   * users: cached feeds and stored articles are purged in the same
   * transaction as the trust change, so a BLOCKED domain cannot keep being
   * served from a cache entry written minutes earlier.
   */
  async purgePublisherContent(domain: string): Promise<{ articles: number; cacheEntries: number }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const articles = await client.query(
        `UPDATE home_news_articles
         SET lifecycle_state='REJECTED', breaking_until=NULL, updated_at=now()
         WHERE publisher_domain=$1 AND lifecycle_state <> 'REJECTED'`,
        [domain.toLowerCase()]
      );
      // The cache stores whole rendered feeds keyed by query, not by
      // publisher, so there is no way to surgically remove one publisher from
      // them. Dropping the news entries forces a clean rebuild on next read.
      const cacheEntries = await client.query(
        `DELETE FROM home_news_cache_entries WHERE cache_key LIKE 'news:%'`
      );
      await client.query("COMMIT");
      return { articles: articles.rowCount ?? 0, cacheEntries: cacheEntries.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
