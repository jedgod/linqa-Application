import type { FastifyRequest } from "fastify";

type Bucket = { count: number; resetAt: number };

/** In-memory, per-process rate limiter (matches the pack's simpleRateLimit).
 * Called explicitly at the top of a route handler (after `auth()` has
 * resolved the caller's userId) rather than as an Express-style middleware
 * chain, since Fastify preHandlers run before the handler body and this
 * codebase's route convention resolves the principal inside the handler. */
export function simpleRateLimit(options: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();
  let nextSweepAt = 0;

  /**
   * Drops buckets whose window has closed.
   *
   * Without this the map is keyed on user *and* IP and nothing ever leaves it,
   * so a limiter on a public route grows once per distinct caller for the life
   * of the process -- the limiter itself becomes the memory-exhaustion vector
   * it exists to prevent. Sweeping at most once per window keeps it O(1)
   * amortised.
   */
  const sweep = (now: number): void => {
    if (now < nextSweepAt) return;
    nextSweepAt = now + options.windowMs;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return (userId: string, request: FastifyRequest): void => {
    const key = `${options.keyPrefix}:${userId}:${request.ip}`;
    const now = Date.now();
    sweep(now);

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
