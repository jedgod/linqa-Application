import { db } from "../db/pool.js";

export async function refreshRecommendationBatch(batch=100) {
  const users=(await db.query(`
    SELECT p.user_id,p.version
    FROM country_discovery_policy_v2 p
    WHERE p.discovery_paused=FALSE
    ORDER BY p.updated_at ASC
    LIMIT $1
  `,[batch])).rows;

  for (const u of users) {
    // Call the same server-authoritative eligibility/ranking service used online.
    // Never create a second privacy implementation in the worker.
    // const recommendations=await advancedDiscovery.people(...)
    // Then atomically replace the snapshot for this policy version.
  }
  return users.length;
}
