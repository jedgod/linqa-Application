const DEFAULT_POOL = 300;
const MIN_POOL = 50;
export const COUNTRYLINQA_CANDIDATE_POOL_HARD_MAX = 1000;

/**
 * How many eligible candidates one discovery request ranks. Tunable with
 * COUNTRYLINQA_CANDIDATE_POOL_LIMIT, but always inside [50, 1000] so a bad
 * value can never turn a request into an unbounded scan.
 */
export function countryLinqaCandidatePoolLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.COUNTRYLINQA_CANDIDATE_POOL_LIMIT ?? DEFAULT_POOL);
  if (!Number.isFinite(raw)) return DEFAULT_POOL;
  return Math.max(MIN_POOL, Math.min(COUNTRYLINQA_CANDIDATE_POOL_HARD_MAX, Math.trunc(raw)));
}
