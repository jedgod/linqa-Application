import type { Database } from "../../../db/pool.js";
import { enqueueCountryNotification } from "../golive/notifications.js";
import { validateFilters, type DiscoveryFilters } from "./filters.js";
import type { AdvancedDiscoveryService } from "./people.js";
import type { DiscoveryControls } from "./controls.js";

const SNAPSHOT_SIZE = 50;
const SNAPSHOT_TTL_HOURS = 6;
const NOTIFIED_CAP = 500;
const ALERT_INTERVAL = "1 hour";

/**
 * Saved searches predate the advanced filter shape (`q`, `country`,
 * `language`). Accept both so existing searches keep working and can opt in to alerts.
 */
export function savedFiltersToDiscovery(raw: unknown): DiscoveryFilters {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mapped: Record<string, unknown> = { ...input };
  if (typeof input.q === "string") { mapped.query = input.q; delete mapped.q; }
  if (typeof input.country === "string") { mapped.countries = [input.country]; delete mapped.country; }
  if (typeof input.language === "string") { mapped.languages = [input.language]; delete mapped.language; }
  delete mapped.onlineOnly;
  return validateFilters(mapped);
}

/**
 * Rebuilds recommendation snapshots for users whose snapshot is missing or
 * expired. The snapshot is computed by the SAME service that serves live
 * discovery, so the worker holds no second copy of the privacy rules. Reads
 * re-check eligibility, so a stale snapshot cannot expose anyone.
 */
export async function refreshRecommendationBatch(
  db: Database, people: AdvancedDiscoveryService, controls: DiscoveryControls, batch = 100
): Promise<{ users: number; skipped: boolean }> {
  if (!(await controls.available("RECOMMENDATIONS"))) return { users: 0, skipped: true };
  const due = await db.query(
    `SELECT u.id FROM users u
     WHERE u.status = 'ACTIVE' AND u.country_verification_state = 'VERIFIED'
       AND NOT EXISTS (SELECT 1 FROM countrylinqa_recommendation_snapshots s WHERE s.user_id = u.id AND s.expires_at > now())
     ORDER BY u.id LIMIT $1`, [batch]
  );
  let refreshed = 0;
  for (const { id } of due.rows as Array<{ id: string }>) {
    if (!(await controls.available("RECOMMENDATIONS", id))) continue;
    try {
      const page = await people.people(id, {}, { limit: SNAPSHOT_SIZE });
      if (page.meta.policyVersion === null) continue;
      await db.query("DELETE FROM countrylinqa_recommendation_snapshots WHERE user_id = $1", [id]);
      if (page.items.length) {
        await db.query(
          `INSERT INTO countrylinqa_recommendation_snapshots (user_id, candidate_user_id, score, reason_codes, policy_version, expires_at)
           SELECT $1, t.candidate, t.score, COALESCE(string_to_array(NULLIF(t.reasons, ''), ','), '{}'), $5::bigint, now() + ($6 || ' hours')::interval
           FROM unnest($2::uuid[], $3::float8[], $4::text[]) AS t(candidate, score, reasons)`,
          [id, page.items.map((i) => i.id), page.items.map((i) => i.rankingScore), page.items.map((i) => i.reasons.join(",")),
            page.meta.policyVersion, String(SNAPSHOT_TTL_HOURS)]
        );
      }
      refreshed++;
    } catch {
      // One user's failure must not stall the batch; they are retried next run.
    }
  }
  return { users: refreshed, skipped: false };
}

/**
 * Runs saved searches that opted in to alerts. Each run resolves the owner's
 * CURRENT policy through the live service (so a policy change or a block
 * silences matches immediately) and notifies only about candidates not
 * reported before. The notification carries a count, never names.
 */
export async function runSavedSearchAlerts(
  db: Database, people: AdvancedDiscoveryService, controls: DiscoveryControls, batch = 100
): Promise<{ searches: number; notified: number; skipped: boolean }> {
  if (!(await controls.available("SAVED_SEARCH_ALERTS"))) return { searches: 0, notified: 0, skipped: true };
  const claimed = await db.query(
    `UPDATE countrylinqa_saved_searches SET last_run_at = now()
     WHERE id IN (
       SELECT id FROM countrylinqa_saved_searches
       WHERE alerts_enabled AND enabled AND (last_run_at IS NULL OR last_run_at < now() - $2::interval)
       ORDER BY last_run_at NULLS FIRST LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, user_id, filters, notified_candidate_ids AS "notified"`,
    [batch, ALERT_INTERVAL]
  );
  let notified = 0;
  for (const search of claimed.rows as Array<{ id: string; user_id: string; filters: unknown; notified: string[] }>) {
    const run = await db.query(
      `INSERT INTO countrylinqa_saved_search_runs (saved_search_id, user_id, status) VALUES ($1, $2, 'RUNNING') RETURNING id`,
      [search.id, search.user_id]
    );
    const runId = run.rows[0].id as string;
    if (!(await controls.available("SAVED_SEARCH_ALERTS", search.user_id))) {
      await db.query(`UPDATE countrylinqa_saved_search_runs SET status = 'SKIPPED', finished_at = now(), error_code = 'NOT_IN_ROLLOUT' WHERE id = $1`, [runId]);
      continue;
    }
    try {
      const page = await people.people(search.user_id, savedFiltersToDiscovery(search.filters), { limit: 50 });
      const seen = new Set(search.notified);
      const fresh = page.items.filter((item) => !seen.has(item.id));
      // The first run only records a baseline, so enabling alerts does not announce everyone already visible.
      const baseline = !(await db.query(
        `SELECT 1 FROM countrylinqa_saved_search_runs WHERE saved_search_id = $1 AND status = 'SUCCEEDED' LIMIT 1`, [search.id]
      )).rowCount;
      let sent = 0;
      if (fresh.length && !baseline) {
        await enqueueCountryNotification(db, {
          userId: search.user_id, notificationType: "SAVED_SEARCH_MATCH",
          payload: { savedSearchId: search.id, newMatches: fresh.length },
          dedupeKey: `saved-search:${search.id}:${new Date().toISOString().slice(0, 13)}`
        });
        sent = 1;
        notified++;
      }
      await db.query(
        `UPDATE countrylinqa_saved_searches SET notified_candidate_ids = (
           SELECT COALESCE(array_agg(x), '{}') FROM (
             SELECT DISTINCT x FROM unnest(notified_candidate_ids || $2::uuid[]) AS x LIMIT ${NOTIFIED_CAP}) capped)
         WHERE id = $1`, [search.id, fresh.map((f) => f.id)]
      );
      await db.query(
        `UPDATE countrylinqa_saved_search_runs SET status = 'SUCCEEDED', finished_at = now(), matched_count = $2, notification_count = $3 WHERE id = $1`,
        [runId, page.items.length, sent]
      );
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "RUN_FAILED";
      await db.query(
        `UPDATE countrylinqa_saved_search_runs SET status = $2, finished_at = now(), error_code = $3 WHERE id = $1`,
        [runId, code.startsWith("INVALID") || code === "UNKNOWN_FILTER" ? "SKIPPED" : "FAILED", code]
      );
    }
  }
  return { searches: claimed.rowCount ?? 0, notified, skipped: false };
}
