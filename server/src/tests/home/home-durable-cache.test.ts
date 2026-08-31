import { describe, expect, it, vi } from "vitest";
import { DurableHomeCache } from "../../home/durable-cache.service.js";
import type { Database } from "../../db/pool.js";
import type { HomeRedisClient } from "../../home/home-redis.client.js";

type Row = { payload: unknown; fresh_until: string; stale_until: string };

function fakeDb(rows: Map<string, Row>) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT payload")) {
        const row = rows.get(String(params[0]));
        const usable = row && new Date(row.stale_until).getTime() > Date.now();
        return { rows: usable ? [row] : [], rowCount: usable ? 1 : 0 };
      }
      writes.push({ sql, params });
      if (sql.startsWith("DELETE")) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 1 };
    })
  } as unknown as Database;
  return { db, writes };
}

function fakeRedis(store = new Map<string, string>(), failing = false): HomeRedisClient & { store: Map<string, string> } {
  return {
    store,
    get: vi.fn(async (key: string) => {
      if (failing) throw new Error("REDIS_DOWN");
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      if (failing) throw new Error("REDIS_DOWN");
      store.set(key, value);
      return "OK";
    }),
    ping: vi.fn(async () => (failing ? Promise.reject(new Error("REDIS_DOWN")) : "PONG")),
    close: vi.fn(async () => undefined)
  } as unknown as HomeRedisClient & { store: Map<string, string> };
}

describe("home durable cache: Redis tier", () => {
  it("serves a fresh Redis hit without querying PostgreSQL", async () => {
    const store = new Map<string, string>([
      [
        "linqa:home:news:GLOBAL",
        JSON.stringify({ payload: ["fresh"], freshUntil: Date.now() + 60_000, staleUntil: Date.now() + 600_000 })
      ]
    ]);
    const { db } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, fakeRedis(store));

    const hit = await cache.get<string[]>("news:GLOBAL");

    expect(hit).toEqual({ value: ["fresh"], stale: false, source: "REDIS" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("ignores a Redis entry whose stale window has closed", async () => {
    const store = new Map<string, string>([
      [
        "linqa:home:news:GLOBAL",
        JSON.stringify({ payload: ["expired"], freshUntil: Date.now() - 600_000, staleUntil: Date.now() - 60_000 })
      ]
    ]);
    const { db } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, fakeRedis(store));

    expect(await cache.get("news:GLOBAL")).toBeNull();
    expect(db.query).toHaveBeenCalled();
  });

  it("writes through to both tiers", async () => {
    const redis = fakeRedis();
    const { db, writes } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, redis);

    await cache.set("news:GLOBAL", ["item"], "ROUTER", 300, 1_800);

    expect(writes.some((write) => write.sql.includes("INSERT INTO home_news_cache_entries"))).toBe(true);
    expect(redis.set).toHaveBeenCalled();
    expect(redis.store.get("linqa:home:news:GLOBAL")).toContain("item");
  });

  it("prefers a fresh PostgreSQL row over a stale Redis one", async () => {
    const store = new Map<string, string>([
      [
        "linqa:home:news:GLOBAL",
        JSON.stringify({ payload: ["stale"], freshUntil: Date.now() - 1_000, staleUntil: Date.now() + 600_000 })
      ]
    ]);
    const rows = new Map<string, Row>([
      [
        "news:GLOBAL",
        {
          payload: ["fresher"],
          fresh_until: new Date(Date.now() + 60_000).toISOString(),
          stale_until: new Date(Date.now() + 600_000).toISOString()
        }
      ]
    ]);
    const { db } = fakeDb(rows);
    const cache = new DurableHomeCache(db, fakeRedis(store));

    const hit = await cache.get<string[]>("news:GLOBAL");

    expect(hit).toEqual({ value: ["fresher"], stale: false, source: "POSTGRES" });
  });

  it("falls back to a stale Redis copy when PostgreSQL has nothing", async () => {
    const store = new Map<string, string>([
      [
        "linqa:home:news:GLOBAL",
        JSON.stringify({ payload: ["stale"], freshUntil: Date.now() - 1_000, staleUntil: Date.now() + 600_000 })
      ]
    ]);
    const { db } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, fakeRedis(store));

    const hit = await cache.get<string[]>("news:GLOBAL");

    expect(hit).toEqual({ value: ["stale"], stale: true, source: "REDIS" });
  });
});

describe("home durable cache: PostgreSQL fallback when Redis fails", () => {
  it("reads from PostgreSQL and reports degradation", async () => {
    const rows = new Map<string, Row>([
      [
        "news:GLOBAL",
        {
          payload: ["durable"],
          fresh_until: new Date(Date.now() + 60_000).toISOString(),
          stale_until: new Date(Date.now() + 600_000).toISOString()
        }
      ]
    ]);
    const { db } = fakeDb(rows);
    const cache = new DurableHomeCache(db, fakeRedis(new Map(), true));

    const hit = await cache.get<string[]>("news:GLOBAL");

    expect(hit?.value).toEqual(["durable"]);
    expect(hit?.source).toBe("POSTGRES");
    expect(cache.redisDegraded()).toBe(true);
  });

  it("completes a write even when the Redis leg throws", async () => {
    const { db, writes } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, fakeRedis(new Map(), true));

    await expect(cache.set("news:GLOBAL", ["item"], "ROUTER", 300, 1_800)).resolves.toBeUndefined();

    expect(writes.some((write) => write.sql.includes("INSERT INTO home_news_cache_entries"))).toBe(true);
    expect(cache.redisDegraded()).toBe(true);
  });

  it("survives an unparseable Redis payload", async () => {
    const store = new Map<string, string>([["linqa:home:news:GLOBAL", "{not json"]]);
    const { db } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, fakeRedis(store));

    await expect(cache.get("news:GLOBAL")).resolves.toBeNull();
  });

  it("works with no Redis configured at all", async () => {
    const rows = new Map<string, Row>([
      [
        "news:GLOBAL",
        {
          payload: ["durable"],
          fresh_until: new Date(Date.now() - 1_000).toISOString(),
          stale_until: new Date(Date.now() + 600_000).toISOString()
        }
      ]
    ]);
    const { db } = fakeDb(rows);
    const cache = new DurableHomeCache(db);

    const hit = await cache.get<string[]>("news:GLOBAL");

    expect(hit).toEqual({ value: ["durable"], stale: true, source: "POSTGRES" });
    expect(cache.redisDegraded()).toBe(false);
  });

  it("keeps oversized payloads out of Redis but still stores them durably", async () => {
    const redis = fakeRedis();
    const { db, writes } = fakeDb(new Map());
    const cache = new DurableHomeCache(db, redis);

    await cache.set("news:GLOBAL", { blob: "x".repeat(600_000) }, "ROUTER", 300, 1_800);

    expect(writes.some((write) => write.sql.includes("INSERT INTO home_news_cache_entries"))).toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe("home durable cache: housekeeping", () => {
  it("prunes entries past their stale window", async () => {
    const { db } = fakeDb(new Map());
    const cache = new DurableHomeCache(db);
    await expect(cache.pruneExpired()).resolves.toBe(3);
  });
});
