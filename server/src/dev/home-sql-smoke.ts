/**
 * Exercises every SQL statement the Home stack issues against a real
 * PostgreSQL instance.
 *
 * The Home unit suite uses fake `db.query` doubles, which cannot catch a bad
 * column name, a CHAR(2) overflow, or a malformed ON CONFLICT clause. This
 * runs the real repositories, cache, personalization and dependency queries
 * end to end and prints what it observed.
 *
 *   DATABASE_URL=... npx tsx src/dev/home-sql-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { createHomeModule } from "../home/home.module.js";
import { createHomeDependencies, resolveJurisdictionCountry } from "../home/home-dependencies.js";
import { NewsValidationService } from "../home/news-validation.service.js";
import type { NewsProvider } from "../home/news-provider.js";
import type { NewsQuery, RawNewsArticle } from "../home/home.types.js";
import { runHomeHousekeepingJob, runRefreshGlobalNewsJob } from "../jobs/home-news.jobs.js";

const config = loadConfig();
const db = createPool(config);

const checks: Array<{ name: string; detail: string }> = [];
const record = (name: string, detail: unknown) => {
  checks.push({ name, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  console.log(`  ok  ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

const userId = randomUUID();

/** A provider whose payload mimics GDELT's real field shapes. */
class FixtureProvider implements NewsProvider {
  readonly name = "GDELT_DOC_2";
  readonly priority = 100;
  isConfigured() {
    return true;
  }
  async fetch(query: NewsQuery): Promise<RawNewsArticle[]> {
    const base = Date.now() - 30 * 60_000;
    const stamp = (offset: number) => new Date(base - offset * 60_000).toISOString();
    return [
      {
        providerName: this.name,
        title: "Central bank holds benchmark rate steady",
        url: "https://reuters.com/markets/rates-hold?utm_source=smoke",
        publishedAt: stamp(0),
        providerScore: 0.7,
        publisherDomain: "reuters.com",
        imageUrl: "https://images.reuters.com/rates.jpg",
        summary: "Policymakers signalled patience on further moves.",
        // Deliberately the un-normalized provider forms: a full country name
        // and a language name, which is what actually breaks CHAR(2).
        countryCode: "United Kingdom",
        sourceLanguage: "English",
        category: query.categories?.[0] ?? "BUSINESS"
      },
      {
        providerName: this.name,
        title: "Regional summit agrees new energy corridor",
        url: "https://apnews.com/world/energy-corridor",
        publishedAt: stamp(20),
        providerScore: 0.7,
        publisherDomain: "apnews.com",
        countryCode: query.countryCode ?? "Kenya",
        sourceLanguage: "English"
      },
      {
        // Blocked publisher: must never reach the store.
        providerName: this.name,
        title: "Thread about the summit goes viral",
        url: "https://reddit.com/r/worldnews/comments/abc",
        publishedAt: stamp(5),
        providerScore: 0.95,
        publisherDomain: "reddit.com"
      },
      {
        // Unlisted publisher below the unknown threshold.
        providerName: this.name,
        title: "Unreviewed outlet reports the same story",
        url: "https://some-random-outlet.example/story",
        publishedAt: stamp(6),
        providerScore: 0.7
      },
      {
        // Plaintext link: must be rejected.
        providerName: this.name,
        title: "Plaintext link to a trusted publisher",
        url: "http://reuters.com/markets/insecure",
        publishedAt: stamp(7),
        providerScore: 0.7
      }
    ];
  }
}

const home = createHomeModule({
  db,
  redisUrl: process.env.REDIS_URL,
  providers: [new FixtureProvider()],
  onRedisError: (error) => console.warn(`  redis unavailable (expected without one): ${error.message}`)
});

try {
  console.log("\n1. seed a user and jurisdiction");
  await db.query(
    `INSERT INTO users (id, external_subject, status, verified_country_code)
     VALUES ($1, $2, 'ACTIVE', 'GB')`,
    [userId, `smoke:${userId}`]
  );
  await db.query(
    `INSERT INTO user_profiles (user_id, display_name, bio) VALUES ($1,'Smoke Tester','Home SQL smoke')`,
    [userId]
  );
  record("resolveJurisdictionCountry", String(await resolveJurisdictionCountry(db, userId)));

  console.log("\n2. publisher trust reads");
  record("trust reuters.com", await home.trust.requireAllowed("reuters.com", 0.7));
  await home.trust
    .requireAllowed("reddit.com", 0.95)
    .then(() => {
      throw new Error("expected reddit.com to be blocked");
    })
    .catch((error: Error) => record("trust reddit.com rejected", error.message));
  record("publisher list size", (await home.publisherRepository.list(500)).length);

  console.log("\n3. validation + persistence of a provider batch");
  const validator = new NewsValidationService(home.trust);
  const raw = await new FixtureProvider().fetch({ limit: 10 });
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const item of raw) {
    try {
      const validated = await validator.validate(item);
      if (validated.validationScore < 0.65 || validated.trustScore < 0.3) {
        rejected.push(`${item.url} -> LOW_SCORE(${validated.validationScore.toFixed(3)})`);
        continue;
      }
      await home.repository.saveArticle(validated);
      accepted.push(`${validated.publisherDomain} country=${validated.countryCode ?? "-"} lang=${validated.sourceLanguage ?? "-"}`);
    } catch (error) {
      rejected.push(`${item.url} -> ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  record("accepted", accepted);
  record("rejected", rejected);
  // Re-saving must be an idempotent upsert, not a duplicate-key error.
  const again = await validator.validate(raw[0]!);
  await home.repository.saveArticle(again);
  record("upsert replay", "ok");

  console.log("\n4. durable-store reads");
  record("listArticles(all)", (await home.repository.listArticles({ limit: 10 })).map((a) => a.publisherName));
  record("listArticles(GB)", (await home.repository.listArticles({ countryCode: "GB", limit: 10 })).length);
  record("listArticles(BUSINESS)", (await home.repository.listArticles({ category: "BUSINESS", limit: 10 })).length);
  record("listArticles(breaking)", (await home.repository.listArticles({ breakingOnly: true, limit: 10 })).length);
  record("listArticles(withImage,since12h)", (await home.repository.listArticles({ withImageOnly: true, sinceHours: 12, limit: 10 })).length);
  record("countArticles", await home.repository.countArticles({}));
  record("categoryTrends", await home.repository.categoryTrends(24, 5));

  console.log("\n5. cache tier");
  await home.cache.set("news:SMOKE:ALL:10:NORMAL", [{ id: "one" }], "SMOKE", 60, 600);
  record("cache read", await home.cache.get("news:SMOKE:ALL:10:NORMAL"));
  await home.cache.set("news:SMOKE:STALE", [{ id: "two" }], "SMOKE", -1, 600);
  record("cache read (stale)", await home.cache.get("news:SMOKE:STALE"));
  record("cache prune", await home.cache.pruneExpired());

  console.log("\n6. provider health + router");
  const routed = await home.router.fetch({ limit: 10 });
  record("router state", `${routed.state} (${routed.articles.length} articles)`);
  record("router cached second call", (await home.router.fetch({ limit: 10 })).state);
  record("provider health", await home.providerHealth.list());
  await home.providerHealth.setState("GDELT_DOC_2", "DISABLED");
  record("provider disabled then re-enabled", (await home.providerHealth.list()).map((row) => row.state));
  await home.providerHealth.setState("GDELT_DOC_2", "HEALTHY");

  console.log("\n7. personalization");
  record("default preferences", await home.personalization.getPreferences(userId));
  record(
    "saved preferences",
    await home.personalization.savePreferences(userId, {
      hiddenSections: ["spotlight", "notARealSection"],
      preferredCategories: ["business", "NOPE"],
      followedCountries: ["gb", "United Kingdom"],
      followedTopics: ["energy"],
      quickActions: [{ key: "chat" }],
      personalizationEnabled: true
    })
  );
  record("reloaded preferences", await home.personalization.getPreferences(userId));

  console.log("\n8. Home dependency queries");
  const dependencies = createHomeDependencies(db, home.repository);
  record("getProfile", await dependencies.getProfile(userId));
  record("getNotifications", await dependencies.getNotifications(userId));
  record("getCountryLinqa", await dependencies.getCountryLinqa(userId, "GB"));
  record("getUpcoming", (await dependencies.getUpcoming(userId)).length);
  record("getContinueYourDay", (await dependencies.getContinueYourDay(userId)).length);
  record("getLiveUpdates", (await dependencies.getLiveUpdates(userId, "GB")).length);
  record("getSpotlight", await dependencies.getSpotlight(userId, "GB"));

  console.log("\n9. full feed build + snapshot");
  const built = createHomeModule({ db, providers: [new FixtureProvider()] });
  const feed = await built.feed.build(userId, "GB");
  record("feed serviceState", feed.serviceState);
  record("feed sections", {
    news: feed.breakingAroundWorld.length,
    liveUpdates: feed.liveUpdates.length,
    upcoming: feed.upcoming.length,
    continueYourDay: feed.continueYourDay.length,
    spotlight: feed.spotlight ? "present" : "absent"
  });
  record("snapshot persisted", await home.repository.getLatestSnapshot(userId) ? "yes" : "no");

  console.log("\n10. health readiness");
  record("readiness", await home.health.readiness());

  console.log("\n11. jobs");
  record("refresh job", await runRefreshGlobalNewsJob({ db, newsRouter: home.router, telemetry: home.telemetry, maxCountries: 3 }));
  record("housekeeping job", await runHomeHousekeepingJob({ repository: home.repository, cache: home.cache }));

  console.log("\n12. publisher admin write (audit + outbox)");
  const { PublisherTrustAdminService } = await import("../home/publisher-trust.admin.service.js");
  const adminService = new PublisherTrustAdminService(db);
  await adminService.upsert(
    {
      domain: "smoke-publisher.example",
      displayName: "Smoke Publisher",
      countryCode: "GB",
      trustStatus: "LIMITED",
      minProviderScore: 0.65,
      allowBreaking: false,
      allowExternalLinks: true,
      attributionRequired: true,
      notes: "created by home-sql-smoke"
    },
    { actorUserId: userId, actorScopes: ["ops:home:publisher:write"], requestId: "smoke", reasonCode: "SMOKE_TEST" }
  );
  const audit = await db.query(
    `SELECT action, resource_id, reason_code FROM ops_audit_events
     WHERE resource_type='home_news_publisher' ORDER BY created_at DESC LIMIT 1`
  );
  record("audit row", audit.rows[0]);
  const outbox = await db.query(
    `SELECT event_type, aggregate_id FROM ops_outbox
     WHERE aggregate_type='home_news_publisher' ORDER BY created_at DESC LIMIT 1`
  );
  record("outbox row", outbox.rows[0]);
  record("purge blocked publisher", await adminService.purgePublisherContent("reuters.com"));

  console.log(`\nALL ${checks.length} HOME SQL CHECKS PASSED`);
} finally {
  await db.query(`DELETE FROM home_news_publishers WHERE canonical_domain='smoke-publisher.example'`);
  await db.query(`DELETE FROM ops_outbox WHERE aggregate_id='smoke-publisher.example'`);
  // ops_audit_events.actor_user_id references users(id) with no cascade --
  // deliberately, so an audit trail cannot be erased by deleting the actor.
  // The smoke user therefore has to drop its audit rows before itself.
  await db.query(`DELETE FROM ops_audit_events WHERE actor_user_id=$1`, [userId]);
  await db.query(`DELETE FROM home_feed_snapshots WHERE user_id=$1`, [userId]);
  await db.query(`DELETE FROM home_feed_preferences WHERE user_id=$1`, [userId]);
  await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await home.close();
  await db.end();
}
