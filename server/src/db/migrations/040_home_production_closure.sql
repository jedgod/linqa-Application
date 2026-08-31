CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS home_news_publishers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_domain TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  country_code CHAR(2),
  trust_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (trust_status IN ('TRUSTED','LIMITED','BLOCKED','UNKNOWN')),
  min_provider_score NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
  allow_breaking BOOLEAN NOT NULL DEFAULT FALSE,
  allow_external_links BOOLEAN NOT NULL DEFAULT TRUE,
  attribution_required BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_news_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url TEXT NOT NULL UNIQUE,
  url_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  image_url TEXT,
  publisher_domain TEXT NOT NULL,
  publisher_name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_article_id TEXT,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  country_code CHAR(2),
  source_language TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERED'
    CHECK (lifecycle_state IN ('DISCOVERED','VALIDATED','DEDUPLICATED','PUBLISHED','UPDATED','CORRECTED','EXPIRED','REJECTED')),
  breaking_until TIMESTAMPTZ,
  content_fingerprint TEXT,
  provider_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  validation_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  trust_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_news_articles_published_at ON home_news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_news_articles_country ON home_news_articles(country_code, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_news_articles_category ON home_news_articles(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_news_articles_state ON home_news_articles(lifecycle_state, breaking_until);

CREATE TABLE IF NOT EXISTS home_news_provider_health (
  provider_name TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'HEALTHY'
    CHECK (state IN ('HEALTHY','DEGRADED','OPEN_CIRCUIT','DISABLED')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  circuit_open_until TIMESTAMPTZ,
  moving_latency_ms NUMERIC(12,2),
  success_rate NUMERIC(6,5) NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_news_cache_entries (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  etag TEXT,
  fresh_until TIMESTAMPTZ NOT NULL,
  stale_until TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_feed_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hidden_sections TEXT[] NOT NULL DEFAULT '{}',
  preferred_categories TEXT[] NOT NULL DEFAULT '{}',
  followed_countries CHAR(2)[] NOT NULL DEFAULT '{}',
  followed_topics TEXT[] NOT NULL DEFAULT '{}',
  quick_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  personalization_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_feed_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jurisdiction_country CHAR(2) NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  source_versions JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_home_feed_snapshots_user ON home_feed_snapshots(user_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS home_release_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  git_sha TEXT NOT NULL,
  server_artifact_sha256 TEXT,
  android_apk_sha256 TEXT,
  ios_artifact_sha256 TEXT,
  device_model TEXT,
  device_os TEXT,
  certification_status TEXT NOT NULL CHECK (certification_status IN ('PENDING','PASSED','FAILED')),
  evidence_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  certified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_release_gate_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  git_sha TEXT NOT NULL,
  gate_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','SKIP')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_release_gate_results_sha ON home_release_gate_results(git_sha, gate_name);
