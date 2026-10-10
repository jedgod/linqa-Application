import { db } from "../db/pool.js";

export async function runSavedSearchAlerts(batch=100) {
  const jobs=(await db.query(`
    SELECT s.*
    FROM countrylinqa_saved_searches s
    WHERE s.alerts_enabled=TRUE
    ORDER BY s.updated_at ASC
    LIMIT $1
  `,[batch])).rows;

  for (const s of jobs) {
    // 1. Revalidate stored filters.
    // 2. Resolve CURRENT CountryLinqa policy and entitlement.
    // 3. Execute current eligibility rules.
    // 4. Compare against prior notified candidate IDs.
    // 5. Enqueue notification through Linqa's durable outbox.
    // 6. Never disclose hidden/private candidates in notification text.
  }
  return jobs.length;
}
