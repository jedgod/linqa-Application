import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { createDiscoveryCache } from "../services/countrylinqa/engine/redis-cache.js";
import { DiscoveryControls } from "../services/countrylinqa/engine/controls.js";
import { cursorKey } from "../services/countrylinqa/engine/cursor.js";
import { AdvancedDiscoveryService } from "../services/countrylinqa/engine/people.js";
import { refreshRecommendationBatch, runSavedSearchAlerts } from "../services/countrylinqa/engine/jobs.js";
import { runCountryLinqaDailyJobs } from "../services/countrylinqa/golive/jobs.js";

/**
 * CountryLinqa background worker (`npm run countrylinqa:workers`): recommendation
 * snapshots, saved-search alerts and the daily metrics roll-up. Safe to run
 * more than once: alert claiming uses FOR UPDATE SKIP LOCKED.
 */
const config = loadConfig();
const db = createPool(config);
const cache = createDiscoveryCache(config.REDIS_URL, (error) => console.warn("countrylinqa cache unavailable:", error.message));
const controls = new DiscoveryControls(db, cache);
const people = new AdvancedDiscoveryService(db, cache, cursorKey(config));

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.COUNTRYLINQA_WORKER_INTERVAL_MS ?? 60_000);
let lastDaily = "";

async function tick() {
  const recommendations = await refreshRecommendationBatch(db, people, controls);
  const alerts = await runSavedSearchAlerts(db, people, controls);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastDaily) {
    await runCountryLinqaDailyJobs(db);
    lastDaily = today;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), recommendations, alerts }));
}

async function main() {
  do {
    try { await tick(); } catch (error) { console.error("countrylinqa worker tick failed", error instanceof Error ? error.message : error); }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
  await db.end();
}

void main();
