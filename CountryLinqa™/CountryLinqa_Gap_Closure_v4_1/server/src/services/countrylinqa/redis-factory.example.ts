/**
 * Example adapter only.
 * Prefer the repository's existing Redis client if one already exists.
 *
 * With ioredis:
 *
 * import Redis from "ioredis";
 * export const countryLinqaRedis =
 *   process.env.REDIS_URL ? new Redis(process.env.REDIS_URL,{
 *     enableOfflineQueue:false,
 *     maxRetriesPerRequest:1,
 *     connectTimeout:2000
 *   }) : null;
 *
 * The CountryLinqa service must continue to work without cache if Redis is down.
 * Privacy/safety checks remain mandatory on every response.
 */
export {};
