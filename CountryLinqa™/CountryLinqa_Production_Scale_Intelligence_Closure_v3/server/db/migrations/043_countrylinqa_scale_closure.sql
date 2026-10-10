BEGIN;

CREATE INDEX IF NOT EXISTS idx_users_country_verified_id
  ON users(verified_country_code, id)
  WHERE verified_country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clq_features_profession_active_user
  ON countrylinqa_user_discovery_features(profession_code, last_active_at DESC, user_id);

CREATE INDEX IF NOT EXISTS idx_clq_policy_discoverable
  ON country_discovery_policy_v2(discovery_paused, inbound_mode, user_id);

CREATE TABLE IF NOT EXISTS countrylinqa_recommendation_snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score DOUBLE PRECISION NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  policy_version BIGINT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id,candidate_user_id,policy_version)
);

CREATE INDEX IF NOT EXISTS idx_clq_reco_user_score
  ON countrylinqa_recommendation_snapshots(user_id,policy_version,score DESC,candidate_user_id);

CREATE TABLE IF NOT EXISTS countrylinqa_saved_search_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_search_id UUID NOT NULL REFERENCES countrylinqa_saved_searches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  matched_count INTEGER,
  notification_count INTEGER,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS countrylinqa_release_certifications (
  release_id TEXT PRIMARY KEY,
  git_sha TEXT NOT NULL,
  server_digest TEXT NOT NULL,
  mobile_digest TEXT NOT NULL,
  migration_level INTEGER NOT NULL,
  environment TEXT NOT NULL,
  evidence JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','PASSED','FAILED','REVOKED')),
  certified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
