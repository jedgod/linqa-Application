import { createHash } from "node:crypto";
import { homeProductionConfig } from "../config/home-production.config.js";
import { HomeRepository } from "./home.repository.js";
import { HomeTelemetryService } from "./home-telemetry.service.js";
import type { HomeFeedPayload, HomeNewsItem } from "./home.types.js";
import { NewsRouterService } from "./news-router.service.js";
import { HomePersonalizationService } from "./personalization.service.js";

export interface HomeFeedDependencies {
  getProfile(userId: string): Promise<unknown>;
  getNotifications(userId: string): Promise<unknown>;
  getCountryLinqa(userId: string, country: string): Promise<unknown>;
  getUpcoming(userId: string): Promise<unknown[]>;
  getContinueYourDay(userId: string): Promise<unknown[]>;
  getVaultRecent(userId: string): Promise<unknown[]>;
  getPendingTransfers(userId: string): Promise<unknown[]>;
  getLiveUpdates(userId: string, country: string): Promise<unknown[]>;
  getSpotlight(userId: string, country: string): Promise<unknown>;
}

type SectionName =
  | "profile"
  | "notifications"
  | "countryLinqa"
  | "upcoming"
  | "continueYourDay"
  | "vault"
  | "transfers"
  | "liveUpdates"
  | "spotlight"
  | "news"
  | "snapshot";

export class HomeFeedService {
  constructor(
    private readonly repository: HomeRepository,
    private readonly newsRouter: NewsRouterService,
    private readonly personalization: HomePersonalizationService,
    private readonly telemetry: HomeTelemetryService,
    private readonly dependencies: HomeFeedDependencies
  ) {}

  /**
   * Builds the authenticated Home payload.
   *
   * Sections are gathered with `allSettled`, not `all`: Home is the app's
   * landing screen, and one failing section (a Spotlight query, a CountryLinqa
   * lookup) must not blank the entire screen. Failed sections come back empty
   * and are named in `serviceState.degraded` so the client can say which part
   * is unavailable instead of pretending the data is simply absent.
   */
  async build(userId: string, country: string): Promise<HomeFeedPayload> {
    const started = Date.now();
    const degraded: SectionName[] = [];

    const settle = async <T>(section: SectionName, work: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await work;
      } catch (error) {
        degraded.push(section);
        this.telemetry.homeSectionFailure(section, error instanceof Error ? error.message : "UNKNOWN");
        return fallback;
      }
    };

    try {
      const preferences = await this.personalization.getPreferences(userId);
      const hidden = (section: string) => preferences.hiddenSections.includes(section);

      const [
        profile,
        notifications,
        countryLinqa,
        upcoming,
        continuing,
        vaultRecent,
        pendingTransfers,
        liveUpdates,
        spotlight,
        news
      ] =
        await Promise.all([
          settle<unknown>("profile", this.dependencies.getProfile(userId), null),
          settle<unknown>("notifications", this.dependencies.getNotifications(userId), null),
          hidden("countryLinqa")
            ? Promise.resolve(null)
            : settle<unknown>("countryLinqa", this.dependencies.getCountryLinqa(userId, country), null),
          hidden("upcoming")
            ? Promise.resolve([])
            : settle<unknown[]>("upcoming", this.dependencies.getUpcoming(userId), []),
          hidden("continueYourDay")
            ? Promise.resolve([])
            : settle<unknown[]>("continueYourDay", this.dependencies.getContinueYourDay(userId), []),
          // Vault and in-flight money are the other two lanes of the same
          // "Continue your day" section, so they follow its visibility flag,
          // but they degrade independently of the conversation list.
          hidden("continueYourDay")
            ? Promise.resolve([])
            : settle<unknown[]>("vault", this.dependencies.getVaultRecent(userId), []),
          hidden("continueYourDay")
            ? Promise.resolve([])
            : settle<unknown[]>("transfers", this.dependencies.getPendingTransfers(userId), []),
          hidden("liveUpdates")
            ? Promise.resolve([])
            : settle<unknown[]>("liveUpdates", this.dependencies.getLiveUpdates(userId, country), []),
          hidden("spotlight")
            ? Promise.resolve(null)
            : settle<unknown>("spotlight", this.dependencies.getSpotlight(userId, country), null),
          hidden("breakingAroundWorld")
            ? Promise.resolve({ articles: [] as HomeNewsItem[], state: "LIVE" as const })
            : settle<{ articles: HomeNewsItem[]; state: "LIVE" | "STALE" | "UNAVAILABLE" }>(
                "news",
                this.newsRouter.fetch({ limit: homeProductionConfig.feed.maxNewsItems }),
                { articles: [], state: "UNAVAILABLE" }
              )
        ]);

      const payload: HomeFeedPayload = {
        generatedAt: new Date().toISOString(),
        jurisdictionCountry: country,
        profile,
        notifications,
        quickActions: preferences.quickActions,
        liveUpdates: liveUpdates.slice(0, homeProductionConfig.feed.maxLiveUpdateItems),
        upcoming: upcoming.slice(0, homeProductionConfig.feed.maxUpcomingItems),
        continueYourDay: continuing.slice(0, homeProductionConfig.feed.maxContinueItems),
        vaultRecent: vaultRecent.slice(0, homeProductionConfig.feed.maxVaultItems),
        pendingTransfers: pendingTransfers.slice(0, homeProductionConfig.feed.maxPendingTransfers),
        countryLinqa,
        breakingAroundWorld: hidden("breakingAroundWorld")
          ? []
          : this.personalization.rankNews(news.articles, preferences, country),
        serviceState: {
          news: hidden("breakingAroundWorld") ? "LIVE" : news.state,
          personalized: preferences.personalizationEnabled,
          hiddenSections: preferences.hiddenSections,
          degraded
        }
      };

      // `exactOptionalPropertyTypes` is on, so an absent Spotlight has to be
      // an absent key rather than an explicit undefined.
      if (!hidden("spotlight") && spotlight !== null) payload.spotlight = spotlight;

      const serialized = JSON.stringify(payload);
      // Snapshot failures must not fail the request: forensics are valuable,
      // but not more valuable than serving Home.
      await settle<void>(
        "snapshot",
        this.repository.saveSnapshot({
          userId,
          country,
          payload,
          hash: createHash("sha256").update(serialized).digest("hex"),
          ttlSeconds: homeProductionConfig.feed.snapshotTtlSeconds
        }),
        undefined
      );

      this.telemetry.homeFeedLatency(Date.now() - started);
      return payload;
    } catch (error) {
      this.telemetry.homeFeedFailure(error instanceof Error ? error.message : "UNKNOWN");
      throw error;
    }
  }
}
