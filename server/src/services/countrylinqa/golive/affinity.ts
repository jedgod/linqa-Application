import type { Database } from "../../../db/pool.js";

const eventWeights: Record<string, number> = {
  IMPRESSION: 0.01,
  OPEN: 0.05,
  LIKE: 0.15,
  FOLLOW: 0.35,
  JOIN: 0.4,
  CONVERT: 0.5,
  HIDE: -0.4,
  BLOCK: -1.0,
  REPORT: -1.5
};

export async function recordRecommendationEvent(
  db: Database,
  input: {
    userId: string;
    candidateType: string;
    candidateId: string;
    countryCode?: string | null | undefined;
    regionCode?: string | null | undefined;
    eventType: keyof typeof eventWeights;
    metadata?: Record<string, unknown> | undefined;
  }
): Promise<void> {
  const weight = eventWeights[input.eventType] ?? 0;

  await db.query(
    `INSERT INTO countrylinqa_recommendation_events
       (user_id, candidate_type, candidate_id, country_code, region_code, event_type, weight, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.userId,
      input.candidateType,
      input.candidateId,
      input.countryCode ?? null,
      input.regionCode ?? null,
      input.eventType,
      weight,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  if (input.countryCode) {
    await db.query(
      `INSERT INTO countrylinqa_user_affinity (user_id, affinity_type, affinity_key, score)
       VALUES ($1, 'COUNTRY', $2, $3)
       ON CONFLICT (user_id, affinity_type, affinity_key)
       DO UPDATE SET score = countrylinqa_user_affinity.score + EXCLUDED.score, updated_at = now()`,
      [input.userId, input.countryCode, weight]
    );
  }
  if (input.regionCode) {
    await db.query(
      `INSERT INTO countrylinqa_user_affinity (user_id, affinity_type, affinity_key, score)
       VALUES ($1, 'REGION', $2, $3)
       ON CONFLICT (user_id, affinity_type, affinity_key)
       DO UPDATE SET score = countrylinqa_user_affinity.score + EXCLUDED.score, updated_at = now()`,
      [input.userId, input.regionCode, weight]
    );
  }
}
