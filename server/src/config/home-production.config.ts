function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const homeProductionConfig = {
  news: {
    requestTimeoutMs: positiveNumber(process.env.HOME_NEWS_TIMEOUT_MS, 5_500),
    cacheFreshSeconds: positiveNumber(process.env.HOME_NEWS_CACHE_FRESH_SECONDS, 300),
    cacheStaleSeconds: positiveNumber(process.env.HOME_NEWS_CACHE_STALE_SECONDS, 1_800),
    maxArticlesPerProvider: positiveNumber(process.env.HOME_NEWS_MAX_PER_PROVIDER, 40),
    providerFailureThreshold: positiveNumber(process.env.HOME_NEWS_FAILURE_THRESHOLD, 3),
    circuitOpenSeconds: positiveNumber(process.env.HOME_NEWS_CIRCUIT_SECONDS, 120),
    // How long a story from a breaking-cleared publisher may carry the
    // BREAKING treatment. `expire-breaking-news` demotes it after this.
    breakingWindowMinutes: positiveNumber(process.env.HOME_NEWS_BREAKING_WINDOW_MINUTES, 90),
    requireHttps: true,
    maxTitleLength: 180,
    maxSummaryLength: 700,
    maxUrlLength: 2_048
  },
  feed: {
    snapshotTtlSeconds: positiveNumber(process.env.HOME_FEED_SNAPSHOT_TTL, 120),
    maxNewsItems: positiveNumber(process.env.HOME_FEED_MAX_NEWS, 40),
    maxUpcomingItems: 10,
    maxContinueItems: 12,
    maxLiveUpdateItems: positiveNumber(process.env.HOME_FEED_MAX_LIVE_UPDATES, 6),
    // "Continue your day" is three lanes on the client: conversations, the
    // most recently touched Vault items, and money that is still in flight.
    maxVaultItems: positiveNumber(process.env.HOME_FEED_MAX_VAULT_ITEMS, 4),
    maxPendingTransfers: positiveNumber(process.env.HOME_FEED_MAX_PENDING_TRANSFERS, 4),
    // The Calls tab badge counts recent missed calls. `call_history` has no
    // per-row "seen" flag, so the badge is a rolling window rather than an
    // unread count, and the window is stated here instead of hard-coded.
    missedCallWindowHours: positiveNumber(process.env.HOME_MISSED_CALL_WINDOW_HOURS, 168),
    // Snapshots are kept for post-incident forensics ("what did this user
    // actually see?"), not as a cache. Pruned by the Home worker.
    snapshotRetentionDays: positiveNumber(process.env.HOME_FEED_SNAPSHOT_RETENTION_DAYS, 7)
  },
  jobs: {
    newsRefreshIntervalSeconds: positiveNumber(process.env.HOME_NEWS_REFRESH_INTERVAL_SECONDS, 300),
    breakingExpiryIntervalSeconds: positiveNumber(process.env.HOME_BREAKING_EXPIRY_INTERVAL_SECONDS, 300),
    maxCountriesPerRefresh: positiveNumber(process.env.HOME_NEWS_REFRESH_MAX_COUNTRIES, 25)
  },
  release: {
    requirePhysicalDeviceEvidence: process.env.HOME_REQUIRE_DEVICE_EVIDENCE !== "false",
    allowedEvidenceAgeHours: positiveNumber(process.env.HOME_EVIDENCE_MAX_AGE_HOURS, 72)
  }
} as const;
