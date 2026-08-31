export interface HomeMetricsSink {
  increment(name: string, labels?: Record<string, string | number | boolean>): void;
  observe(name: string, value: number, labels?: Record<string, string | number | boolean>): void;
}

/**
 * The Home telemetry contract (Closure Pack v1.0 §23). The metric names below
 * are what the production alerts are written against, so they are treated as
 * a public interface — add names, don't rename them.
 */
export class HomeTelemetryService {
  constructor(private readonly metrics?: HomeMetricsSink) {}

  newsRequest(provider: string): void {
    this.metrics?.increment("linqa_news_provider_requests_total", { provider });
  }

  newsFailure(provider: string, reason: string): void {
    this.metrics?.increment("linqa_news_provider_failures_total", { provider, reason });
  }

  newsLatency(provider: string, ms: number): void {
    this.metrics?.observe("linqa_news_provider_latency_ms", ms, { provider });
  }

  cacheHit(stale: boolean): void {
    this.metrics?.increment(
      stale ? "linqa_news_cache_stale_served_total" : "linqa_news_cache_hits_total"
    );
  }

  rejected(reason: string): void {
    this.metrics?.increment("linqa_news_articles_rejected_total", { reason });
  }

  homeFeedLatency(ms: number): void {
    this.metrics?.observe("linqa_home_feed_latency_ms", ms);
  }

  homeFeedFailure(reason: string): void {
    this.metrics?.increment("linqa_home_feed_failures_total", { reason });
  }

  /**
   * A single Home section failing is a degradation, not an outage — it is
   * counted separately so a broken Spotlight query cannot hide behind (or be
   * mistaken for) a real Home outage on the P1 alert.
   */
  homeSectionFailure(section: string, reason: string): void {
    this.metrics?.increment("linqa_home_section_failures_total", { section, reason });
  }

  newsRefreshRun(scope: string, articles: number): void {
    this.metrics?.increment("linqa_news_refresh_runs_total", { scope });
    this.metrics?.observe("linqa_news_refresh_articles", articles, { scope });
  }
}
