# Linqa Home — production module

Implements **Home Production Closure Pack v1.0** and **Home Implementation
Completion Pack v1.1** for this repository.

The packs are written for Express with `req.session`; this server is Fastify
with bearer-JWT principals, so routes use the existing
`createAuthenticator` / `requireScope` mechanism rather than introducing a
second session concept. Everything else follows the packs.

## Contract

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/mobile/home` | `profile:read` | Aggregated Home feed |
| GET | `/v1/mobile/home/preferences` | `profile:read` | Section visibility + personalization |
| PUT | `/v1/mobile/home/preferences` | `profile:read` | Update the above |
| GET | `/v1/mobile/home/news` | `profile:read` | World News list from the durable store |
| GET | `/health/home` | none | Dependency readiness probe |
| GET | `/v1/admin/home/publishers` | `ops:home:publisher:read` | Publisher trust allowlist |
| PUT | `/v1/admin/home/publishers/:domain` | `ops:home:publisher:write` | Audited trust change |
| GET | `/v1/admin/home/providers` | `ops:home:publisher:read` | Provider health + readiness |
| PUT | `/v1/admin/home/providers/:provider/state` | `ops:home:publisher:write` | Take a provider out of rotation |

`/v1/mobile/home` returns **409 `HOME_JURISDICTION_REQUIRED`** until the user
has a verified country. Jurisdiction is server-authoritative
(`users.verified_country_code`); the client cannot assert it.

`/v1/mobile-hub/home-feed` still serves the *old* payload shape from
`routes/mobile-hub.ts` for already-installed builds. `/v1/mobile/home` moved
out of that file — Fastify rejects duplicate route registration, so the
aggregated feed is now the single owner of that path.

## Fail-honest behaviour

`serviceState.news` is the whole point of the contract:

- `LIVE` — served from a fresh cache entry or a successful provider refresh.
- `STALE` — every provider failed; the last validated articles are being
  served and are marked as such.
- `UNAVAILABLE` — no provider and no cache. The response carries **zero**
  articles. Home never fabricates a headline, and the release gate scans
  tracked source for hard-coded fallback content to keep it that way.

Individual sections degrade independently: `build()` gathers them with
`allSettled`, and anything that failed is named in `serviceState.degraded` so
the client can say which part is unavailable rather than showing an
indistinguishable empty state.

## Why the publisher allowlist is load-bearing

Validation is fail-closed by arithmetic, not just by policy:

```
validationScore = 0.35
                + providerScore * 0.25
                + (TRUSTED 0.30 | LIMITED 0.15 | else 0.05)
                + 0.05 if summary
                + 0.05 if image
```

The router drops anything under `0.65`. GDELT reports `providerScore = 0.70`,
so an `UNKNOWN` publisher cannot clear the floor, and `PublisherTrustService`
rejects unlisted domains under `0.80` before that anyway.

**With an empty allowlist every article is rejected and Home reports
`UNAVAILABLE` forever, with no error anywhere.** Migration
`041_home_publisher_trust_seed.sql` seeds a starting allowlist, and
`/health/home` fails readiness when it is empty rather than letting that look
healthy. Curate it through the audited admin API, not by editing the seed.

## Provider notes

GDELT DOC 2.0 (`mode=artlist`) does not return machine codes:

- `seendate` is `20260829T010000Z` — **`new Date()` rejects this**
- `sourcecountry` is `"United Kingdom"` — but `country_code` is `CHAR(2)`
- `language` is `"English"` — not ISO 639-1

`news-normalization.ts` converts all three. Passing them through unchanged
(as the pack's sample provider did) rejects every article with
`INVALID_NEWS_PUBLISHED_AT` and overflows the country column.

## Cache tiers

Redis is an accelerator; **PostgreSQL is authoritative**. Every Redis error is
swallowed and reported as `checks.redis.degraded` on `/health/home` — a Redis
outage must never become a Home outage. `REDIS_URL` is optional.

`home-redis.client.ts` is a dependency-free RESP2 client (GET/SET/PING only)
with length-prefixed bulk-string parsing, because a cached feed spans multiple
TCP segments.

## Background worker

```
npm run home:workers
```

- refreshes global + per-jurisdiction news every `HOME_NEWS_REFRESH_INTERVAL_SECONDS`
  (default 300s, sized against the 300s fresh / 1800s stale cache window)
- closes breaking windows, expires aged articles, prunes cache rows and snapshots

Run it as its own process so a slow provider can never occupy an API handler.

A cold cache with dead providers costs one provider timeout per request until
the circuit breaker opens (3 consecutive failures → 120s open). Keeping the
worker running is what keeps the request path a cache hit.

## Deployment order

1. `npm run db:migrate` — applies `040_home_production_closure.sql` and
   `041_home_publisher_trust_seed.sql`.
2. Review the seeded allowlist. Adding a publisher is an editorial decision.
3. Set `HOME_APPROVED_RSS_ENDPOINT` — the release gate blocks promotion
   without a second provider.
4. Set `REDIS_URL` if Redis is available.
5. Deploy the API. `/v1/mobile/home` and `/health/home` register automatically
   via `bootstrap/register-all.ts`.
6. Start `npm run home:workers`.
7. Confirm `/health/home` returns 200 with `newsProviders.redundant: true` and
   `publisherTrust.trustedPublishers > 0`.
8. Build the Android APK from a clean, exact Git SHA.
9. `npm run home:device:certify` on the approved physical device.
10. `npm run home:evidence:collect`.
11. `npm run home:release:gate` — promote only if it passes with no SKIPs.

## Verification

```
npm run home:test          # 227 unit/contract tests, no placeholder assertions
npm run home:release:gate  # full gate: build, mobile tsc, tests, evidence
```

Unit tests use fake `db.query` doubles, which cannot catch a bad column name
or a `CHAR(2)` overflow. `src/dev/home-sql-smoke.ts` runs every real SQL
statement the module issues against a live PostgreSQL instance:

```
DATABASE_URL=postgresql://... [REDIS_URL=redis://...] npx tsx src/dev/home-sql-smoke.ts
```

## Telemetry

```
linqa_news_provider_requests_total{provider}
linqa_news_provider_failures_total{provider,reason}
linqa_news_provider_latency_ms{provider}
linqa_news_cache_hits_total
linqa_news_cache_stale_served_total
linqa_news_articles_rejected_total{reason}
linqa_news_refresh_runs_total{scope}
linqa_home_feed_latency_ms
linqa_home_feed_failures_total{reason}
linqa_home_section_failures_total{section,reason}
```

Exposed on `/metrics`. The names are what production alerts are written
against — add names, don't rename them. Rejection `reason` values are the
`throw new Error(...)` strings in `news-validation.service.ts`.

Suggested thresholds (pack v1.0 §23):

- **P1** Home API error rate > 5% for 5 min
- **P1** all providers unavailable and stale cache exhausted
- **P2** primary provider failure rate > 40% for 10 min
- **P2** p95 `linqa_home_feed_latency_ms` > 1500 ms for 10 min
- **P2** stale news served > 20% for 15 min
- **P3** publisher rejection spike > 3x 7-day baseline
