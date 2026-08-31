import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { homeProductionConfig } from "../config/home-production.config.js";
import { createHomeModule } from "../home/home.module.js";
import { runHomeHousekeepingJob, runRefreshGlobalNewsJob } from "./home-news.jobs.js";

/**
 * Home background worker: keeps the news cache warm and does the lifecycle
 * housekeeping. Runs as its own process (`npm run home:workers`) so a slow
 * provider can never occupy an API request handler.
 */
const config = loadConfig();
const db = createPool(config);
const home = createHomeModule({
  db,
  redisUrl: config.REDIS_URL,
  onRedisError: (error) => {
    console.warn(JSON.stringify({ worker: "home", event: "redis_unavailable", error: error.message }));
  }
});

const log = (event: string, detail: Record<string, unknown>) => {
  console.log(JSON.stringify({ worker: "home", event, at: new Date().toISOString(), ...detail }));
};

if (!home.router.configuredProviders().length) {
  throw new Error("HOME_WORKER_REQUIRES_AT_LEAST_ONE_CONFIGURED_NEWS_PROVIDER");
}

let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

let nextRefreshAt = 0;
let nextHousekeepingAt = 0;

// A single loop with per-task due times, rather than two setIntervals: it
// keeps the two tasks from overlapping each other and makes shutdown a single
// checked flag.
while (!stopping) {
  const now = Date.now();

  if (now >= nextRefreshAt) {
    try {
      const result = await runRefreshGlobalNewsJob({
        db,
        newsRouter: home.router,
        telemetry: home.telemetry
      });
      log("news_refresh", { ...result });
    } catch (error) {
      log("news_refresh_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    nextRefreshAt = Date.now() + homeProductionConfig.jobs.newsRefreshIntervalSeconds * 1_000;
  }

  if (now >= nextHousekeepingAt) {
    try {
      const result = await runHomeHousekeepingJob({ repository: home.repository, cache: home.cache });
      log("housekeeping", { ...result });
    } catch (error) {
      log("housekeeping_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    nextHousekeepingAt = Date.now() + homeProductionConfig.jobs.breakingExpiryIntervalSeconds * 1_000;
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

await home.close();
await db.end();
log("stopped", {});
