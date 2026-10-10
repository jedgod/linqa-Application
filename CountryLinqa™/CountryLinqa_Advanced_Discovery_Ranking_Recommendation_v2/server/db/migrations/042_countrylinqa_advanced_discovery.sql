BEGIN;

CREATE TABLE IF NOT EXISTS countrylinqa_user_discovery_features (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  languages TEXT[] NOT NULL DEFAULT '{}',
  interests TEXT[] NOT NULL DEFAULT '{}',
  profession_code TEXT,
  relationship_intent TEXT,
  discoverable BOOLEAN NOT NULL DEFAULT TRUE,
  last_active_at TIMESTAMPTZ,
  feature_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countrylinqa_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  query_text TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_countrylinqa_saved_searches_user
  ON countrylinqa_saved_searches(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_countrylinqa_features_languages
  ON countrylinqa_user_discovery_features USING GIN(languages);

CREATE INDEX IF NOT EXISTS idx_countrylinqa_features_interests
  ON countrylinqa_user_discovery_features USING GIN(interests);

CREATE INDEX IF NOT EXISTS idx_countrylinqa_features_profession
  ON countrylinqa_user_discovery_features(profession_code);

CREATE INDEX IF NOT EXISTS idx_countrylinqa_features_active
  ON countrylinqa_user_discovery_features(last_active_at DESC);

CREATE TABLE IF NOT EXISTS countrylinqa_discovery_impressions (
  id BIGSERIAL PRIMARY KEY,
  viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  rank_position INTEGER NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  policy_version BIGINT,
  experiment_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_countrylinqa_impressions_viewer_time
  ON countrylinqa_discovery_impressions(viewer_user_id, created_at DESC);

COMMIT;
