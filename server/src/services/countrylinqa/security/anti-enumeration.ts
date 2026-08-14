import type { FastifyRequest } from "fastify";
import type { Database } from "../../../db/pool.js";
import { securityLog } from "./security-log.js";

type Bucket = { count: number; resetAt: number };

/** Burst-rate throttle per user+IP+path, ported as an explicit call (see
 * final/rate-limit.ts for why this codebase's routes resolve the principal
 * before calling shared limiters, rather than an Express middleware chain). */
export function antiEnumeration(options: { threshold?: number; windowMs?: number } = {}) {
  const threshold = options.threshold ?? 120;
  const windowMs = options.windowMs ?? 60_000;
  const buckets = new Map<string, Bucket>();

  return async (db: Database, userId: string | null, request: FastifyRequest): Promise<void> => {
    const key = `${userId ?? "anonymous"}:${request.ip}:${request.url.split("?")[0]}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > threshold) {
      await securityLog(db, {
        userId,
        eventType: "ENUMERATION_RATE_EXCEEDED",
        severity: "HIGH",
        ip: request.ip
      });
      const error: any = new Error("Request limit reached.");
      error.status = 429;
      error.code = "REQUEST_LIMIT_REACHED";
      throw error;
    }
  };
}
