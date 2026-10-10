import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/pool.js";
import type { AppConfig } from "../../config.js";
import { createAuthenticator } from "../../auth/jwt.js";

/** Atomic, shared quotas: IP changes and process restarts cannot reset a user's quota. */
export async function consumeQuota(db: Database, key: string, windowMs: number, max: number) {
  const hash = createHash("sha256").update(key).digest("hex");
  const result = await db.query(`WITH expired AS (
    SELECT ctid FROM countrylinqa_rate_buckets WHERE expires_at < clock_timestamp()
    LIMIT 100 FOR UPDATE SKIP LOCKED
  ), pruned AS (
    DELETE FROM countrylinqa_rate_buckets bucket USING expired WHERE bucket.ctid=expired.ctid
  ) INSERT INTO countrylinqa_rate_buckets (key, window_start, count, expires_at)
    VALUES ($1, floor(extract(epoch FROM clock_timestamp())*1000/$2)::bigint, 1,
      to_timestamp((floor(extract(epoch FROM clock_timestamp())*1000/$2)+1)*$2/1000))
    ON CONFLICT (key,window_start) DO UPDATE SET count=LEAST(countrylinqa_rate_buckets.count+1,$3+1)
    RETURNING count`, [hash, windowMs, max]);
  if (!result.rows[0]) throw new Error("Quota store unavailable");
  if (Number(result.rows[0].count) > max) throw Object.assign(new Error("Rate limited"), { status: 429, code: "RATE_LIMITED" });
}

export function registerCountrySecurity(app: FastifyInstance, config: AppConfig, db: Database) {
  const auth = createAuthenticator(config);
  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url ?? "";
    if (!route.startsWith("/v1/countrylinqa/")) return;
    try { await consumeQuota(db, `ip:${request.ip}`, 60_000, 120); }
    catch (error) {
      const limited = (error as { code?: string }).code === "RATE_LIMITED";
      request.log.warn({ err: error }, "CountryLinqa shared IP quota rejected");
      return reply.code(limited ? 429 : 503).send({ error: limited ? "RATE_LIMITED" : "authorization_unavailable" });
    }
    let p;
    try { p = await auth(request); }
    catch { return reply.code(401).send({ error: "unauthorized" }); }
    try {
      const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      await consumeQuota(db, `user:${p.userId}:${write ? "write" : "read"}`, write ? 3_600_000 : 60_000, write ? 60 : 120);
      if (route.includes("confirm-country")) await consumeQuota(db, `country-confirm:${p.userId}`, 3_600_000, 5);
      if (write) await consumeQuota(db, `route:${p.userId}:${request.method}:${route}`, 3_600_000, 30);
    } catch (error) {
      const e = error as { code?: string };
      const limited = e.code === "RATE_LIMITED";
      request.log.warn({ err: error }, "CountryLinqa authorization or quota rejected");
      return reply.code(limited ? 429 : 503).send({ error: limited ? "RATE_LIMITED" : "authorization_unavailable" });
    }
  });
}
