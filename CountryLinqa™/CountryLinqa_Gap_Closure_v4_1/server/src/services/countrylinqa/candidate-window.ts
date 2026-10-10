const DEFAULT_POOL=300;
const HARD_MAX=1000;

export function countryLinqaCandidatePoolLimit(env=process.env){
  const raw=Number(env.COUNTRYLINQA_CANDIDATE_POOL_LIMIT ?? DEFAULT_POOL);
  if(!Number.isFinite(raw)) return DEFAULT_POOL;
  return Math.max(50,Math.min(HARD_MAX,Math.trunc(raw)));
}

export const COUNTRYLINQA_CANDIDATE_POOL_HARD_MAX=HARD_MAX;
