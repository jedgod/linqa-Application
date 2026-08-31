import type { Database } from "../db/pool.js";
import type { HomeRedisClient } from "./home-redis.client.js";

export interface CacheHit<T> {
  value: T;
  stale: boolean;
  source: "REDIS" | "POSTGRES";
}

type RedisEnvelope<T> = { payload: T; freshUntil: number; staleUntil: number };

// Values above this are kept in PostgreSQL only. A multi-megabyte SET would
// block the Redis event loop for every other caller, and Home's own payloads
// are far below this — exceeding it means something upstream went wrong.
const MAX_REDIS_VALUE_BYTES = 512 * 1024;

/**
 * Two-tier Home cache. Redis is an accelerator; PostgreSQL is authoritative.
 *
 * Every Redis error is swallowed by design: the pack's own definition of done
 * requires Home to keep working when Redis fails, so a Redis outage must
 * degrade to a PostgreSQL read, never to a 5xx.
 */
export class DurableHomeCache {
  private redisDegradedSince: number | null = null;

  constructor(
    private readonly db: Database,
    private readonly redis?: HomeRedisClient
  ) {}

  /** Exposed on /health/home so a silent Redis degradation is visible. */
  redisDegraded(): boolean {
    return this.redisDegradedSince !== null;
  }

  private redisKey(key: string): string {
    return `linqa:home:${key}`;
  }

  async get<T>(key: string): Promise<CacheHit<T> | null> {
    let redisFallback: CacheHit<T> | null = null;

    if (this.redis) {
      try {
        const raw = await this.redis.get(this.redisKey(key));
        this.redisDegradedSince = null;
        if (raw) {
          const parsed = JSON.parse(raw) as RedisEnvelope<T>;
          if (parsed.staleUntil > Date.now()) {
            const hit: CacheHit<T> = {
              value: parsed.payload,
              stale: parsed.freshUntil <= Date.now(),
              source: "REDIS"
            };
            if (!hit.stale) return hit;
            // A stale Redis copy is still better than nothing, but PostgreSQL
            // may hold a fresher one (another instance could have just
            // refreshed it), so check there before settling for this.
            redisFallback = hit;
          }
        }
      } catch {
        this.redisDegradedSince ??= Date.now();
      }
    }

    try {
      const result = await this.db.query(
        `SELECT payload,fresh_until,stale_until FROM home_news_cache_entries
         WHERE cache_key=$1 AND stale_until>now()`,
        [key]
      );
      const row = result.rows[0] as { payload: T; fresh_until: string | Date } | undefined;
      if (row) {
        return {
          value: row.payload,
          stale: new Date(row.fresh_until).getTime() <= Date.now(),
          source: "POSTGRES"
        };
      }
    } catch (error) {
      // If PostgreSQL is down too, a stale Redis copy is the last honest
      // answer available; otherwise let the caller see the failure.
      if (redisFallback) return redisFallback;
      throw error;
    }

    return redisFallback;
  }

  async set<T>(
    key: string,
    payload: T,
    source: string,
    freshSeconds: number,
    staleSeconds: number
  ): Promise<void> {
    const freshUntil = Date.now() + freshSeconds * 1_000;
    const staleUntil = Date.now() + Math.max(staleSeconds, freshSeconds) * 1_000;
    const serialized = JSON.stringify(payload);

    await this.db.query(
      `INSERT INTO home_news_cache_entries(cache_key,payload,fresh_until,stale_until,source)
       VALUES($1,$2::jsonb,to_timestamp($3/1000.0),to_timestamp($4/1000.0),$5)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload=EXCLUDED.payload,
         fresh_until=EXCLUDED.fresh_until,
         stale_until=EXCLUDED.stale_until,
         source=EXCLUDED.source,
         updated_at=now()`,
      [key, serialized, freshUntil, staleUntil, source]
    );

    if (!this.redis) return;
    const envelope = JSON.stringify({ payload, freshUntil, staleUntil });
    if (Buffer.byteLength(envelope) > MAX_REDIS_VALUE_BYTES) return;
    try {
      await this.redis.set(this.redisKey(key), envelope, { PX: staleSeconds * 1_000 });
      this.redisDegradedSince = null;
    } catch {
      // PostgreSQL already holds the authoritative copy written above.
      this.redisDegradedSince ??= Date.now();
    }
  }

  /** Drops rows whose stale window has closed. Called by the Home worker. */
  async pruneExpired(): Promise<number> {
    const result = await this.db.query(`DELETE FROM home_news_cache_entries WHERE stale_until < now()`);
    return result.rowCount ?? 0;
  }
}
