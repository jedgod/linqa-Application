-- CountryLinqa discovery engine (packs v1-v4), adapted to the live schema.
--
-- Deliberately does NOT create country_discovery_policy_v2: migration 027
-- already models outbound mode, inbound reach, pause, verified-only and the
-- per-surface toggles on country_discovery_preferences. Adding a second policy
-- table would give discovery two sources of truth. Instead the existing row
-- gains a monotonically increasing version, which cache keys and pagination
-- cursors bind to.

ALTER TABLE country_discovery_preferences
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN country_discovery_preferences.version IS
  'Incremented on every saved change. Bound into discovery cache keys and cursors so stale pages are unreachable after a policy change.';

-- Profile features used for ranking only. They never widen geographic scope.
CREATE TABLE IF NOT EXISTS countrylinqa_user_discovery_features (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  languages TEXT[] NOT NULL DEFAULT '{}',
  interests TEXT[] NOT NULL DEFAULT '{}',
  profession_code TEXT,
  discoverable BOOLEAN NOT NULL DEFAULT TRUE,
  feature_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clq_features_languages_len CHECK (cardinality(languages) <= 10),
  CONSTRAINT clq_features_interests_len CHECK (cardinality(interests) <= 20)
);
CREATE INDEX IF NOT EXISTS idx_clq_features_languages ON countrylinqa_user_discovery_features USING GIN(languages);
CREATE INDEX IF NOT EXISTS idx_clq_features_interests ON countrylinqa_user_discovery_features USING GIN(interests);
CREATE INDEX IF NOT EXISTS idx_clq_features_profession ON countrylinqa_user_discovery_features(profession_code, user_id);

-- Saved searches gain a text query, alert opt-in and the candidates already
-- notified, so an alert run only reports people that are new to the search.
ALTER TABLE countrylinqa_saved_searches
  ADD COLUMN IF NOT EXISTS query_text TEXT,
  ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_candidate_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_clq_saved_searches_alerts
  ON countrylinqa_saved_searches(last_run_at NULLS FIRST) WHERE alerts_enabled AND enabled;

CREATE TABLE IF NOT EXISTS countrylinqa_saved_search_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_search_id UUID NOT NULL REFERENCES countrylinqa_saved_searches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  matched_count INTEGER,
  notification_count INTEGER,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_clq_saved_search_runs_search ON countrylinqa_saved_search_runs(saved_search_id, started_at DESC);

-- Impressions record rank and reason codes, never search text or coordinates.
CREATE TABLE IF NOT EXISTS countrylinqa_discovery_impressions (
  id BIGSERIAL PRIMARY KEY,
  viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  rank_position INTEGER NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  policy_version BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clq_impressions_viewer_time ON countrylinqa_discovery_impressions(viewer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS countrylinqa_recommendation_snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score DOUBLE PRECISION NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  policy_version BIGINT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, candidate_user_id, policy_version)
);
CREATE INDEX IF NOT EXISTS idx_clq_reco_user_score
  ON countrylinqa_recommendation_snapshots(user_id, policy_version, score DESC, candidate_user_id);

-- Release certification evidence, bound to an exact git SHA and artifact digests.
CREATE TABLE IF NOT EXISTS countrylinqa_release_certifications (
  release_id TEXT PRIMARY KEY,
  git_sha TEXT NOT NULL,
  server_digest TEXT NOT NULL,
  mobile_digest TEXT NOT NULL,
  migration_level INTEGER NOT NULL,
  environment TEXT NOT NULL,
  evidence JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PASSED','FAILED','REVOKED')),
  certified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Candidate scans are scoped by verified country and keyed by id.
CREATE INDEX IF NOT EXISTS idx_users_country_verified_id
  ON users(verified_country_code, id) WHERE verified_country_code IS NOT NULL;

-- Kill switches. A flag set to FALSE turns the surface off immediately (60s cache).
INSERT INTO countrylinqa_feature_flags (key, enabled, config) VALUES
  ('countrylinqa.people', TRUE, '{}'::jsonb),
  ('countrylinqa.recommendations', TRUE, '{}'::jsonb),
  ('countrylinqa.saved_search_alerts', TRUE, '{}'::jsonb),
  ('countrylinqa.advanced_ranking', TRUE, '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;
