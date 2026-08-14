import type { FastifyRequest } from "fastify";

type Bucket = { count: number; resetAt: number };

/** In-memory, per-process rate limiter (matches the pack's simpleRateLimit).
 * Called explicitly at the top of a route handler (after `auth()` has
 * resolved the caller's userId) rather than as an Express-style middleware
 * chain, since Fastify preHandlers run before the handler body and this
 * codebase's route convention resolves the principal inside the handler. */
export function simpleRateLimit(options: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();

  return (userId: string, request: FastifyRequest): void => {
    const key = `${options.keyPrefix}:${userId}:${request.ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > options.max) {
      const error: any = new Error("Rate limit exceeded.");
      error.status = 429;
      error.code = "RATE_LIMITED";
      throw error;
    }
  };
}
