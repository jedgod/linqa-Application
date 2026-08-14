BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE country_discovery_mode AS ENUM ('MY_COUNTRY','SELECTED_COUNTRIES','REGION','GLOBAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE country_verification_state AS ENUM ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED','RESTRICTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE location_precision AS ENUM ('COUNTRY','STATE','CITY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===================== base layer =====================

CREATE TABLE IF NOT EXISTS geographic_regions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_code TEXT REFERENCES geographic_regions(code) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countries (
  code CHAR(2) PRIMARY KEY,
  iso3 CHAR(3),
  name TEXT NOT NULL UNIQUE,
  calling_code TEXT,
  region_code TEXT REFERENCES geographic_regions(code) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_country_code CHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_verification_state country_verification_state NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS state_region TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_precision location_precision NOT NULL DEFAULT 'COUNTRY';
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_city BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_verified_country_fk FOREIGN KEY (verified_country_code) REFERENCES countries(code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS country_discovery_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode country_discovery_mode NOT NULL DEFAULT 'MY_COUNTRY',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS country_links (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country_code)
);

CREATE TABLE IF NOT EXISTS regional_links (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL REFERENCES geographic_regions(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, region_code)
);

CREATE TABLE IF NOT EXISTS country_verification_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_country_code CHAR(2),
  carrier_country_code CHAR(2),
  sim_country_code CHAR(2),
  ip_country_code CHAR(2),
  locale_country_code CHAR(2),
  user_claimed_country_code CHAR(2),
  line_type TEXT,
  carrier_name TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_country_evidence_user_created ON country_verification_evidence(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS country_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  score_delta INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_country_risk_open ON country_risk_events(user_id, created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS country_admin_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) REFERENCES countries(code),
  region_code TEXT REFERENCES geographic_regions(code),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_verified_country ON users(verified_country_code) WHERE verified_country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_country_links_country ON country_links(country_code, user_id);
CREATE INDEX IF NOT EXISTS idx_regional_links_region ON regional_links(region_code, user_id);

-- ===================== go-live layer =====================

CREATE TABLE IF NOT EXISTS countrylinqa_recommendation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_type TEXT NOT NULL,
  candidate_id UUID NOT NULL,
  country_code CHAR(2),
  region_code TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('IMPRESSION','OPEN','LIKE','FOLLOW','JOIN','HIDE','BLOCK','REPORT','CONVERT')),
  weight NUMERIC NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_rec_events_user ON countrylinqa_recommendation_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_rec_events_candidate ON countrylinqa_recommendation_events(candidate_type,candidate_id,created_at DESC);

CREATE TABLE IF NOT EXISTS countrylinqa_user_affinity (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  affinity_type TEXT NOT NULL,
  affinity_key TEXT NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, affinity_type, affinity_key)
);

CREATE TABLE IF NOT EXISTS countrylinqa_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  country_trends BOOLEAN NOT NULL DEFAULT TRUE,
  regional_trends BOOLEAN NOT NULL DEFAULT TRUE,
  selected_country_activity BOOLEAN NOT NULL DEFAULT TRUE,
  country_events BOOLEAN NOT NULL DEFAULT TRUE,
  country_businesses BOOLEAN NOT NULL DEFAULT FALSE,
  security_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  digest_frequency TEXT NOT NULL DEFAULT 'DAILY' CHECK (digest_frequency IN ('OFF','DAILY','WEEKLY')),
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countrylinqa_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_countrylinqa_notification_dedupe ON countrylinqa_notification_outbox(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_countrylinqa_notification_pending ON countrylinqa_notification_outbox(status,available_at) WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS countrylinqa_moderation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  country_code CHAR(2),
  region_code TEXT,
  reason_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','RESOLVED','DISMISSED')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_moderation_open ON countrylinqa_moderation_queue(status,priority DESC,created_at) WHERE status IN ('OPEN','ASSIGNED');

CREATE TABLE IF NOT EXISTS countrylinqa_rollouts (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  percentage INTEGER NOT NULL DEFAULT 0 CHECK (percentage BETWEEN 0 AND 100),
  country_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  country_blocklist TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  tier_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO countrylinqa_rollouts (key, enabled, percentage) VALUES
  ('linqa_world.home', TRUE, 100),
  ('linqa_world.cross_country', TRUE, 100),
  ('linqa_world.regional', TRUE, 100),
  ('linqa_world.global', TRUE, 100),
  ('linqa_world.businesses', TRUE, 100),
  ('linqa_world.events', TRUE, 100),
  ('linqa_world.ai_recommendations', FALSE, 0)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS countrylinqa_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED','SUCCEEDED','FAILED')),
  cursor TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_job_runs_name ON countrylinqa_job_runs(job_name,started_at DESC);

CREATE TABLE IF NOT EXISTS countrylinqa_metrics_daily (
  metric_date DATE NOT NULL,
  country_code CHAR(2),
  region_code TEXT,
  metric_key TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(metric_date, metric_key, country_code, region_code, dimensions)
);

-- ===================== final layer =====================

CREATE TABLE IF NOT EXISTS countrylinqa_feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO countrylinqa_feature_flags (key, enabled, config) VALUES
  ('countrylinqa.enabled', TRUE, '{}'::jsonb),
  ('countrylinqa.business_targeting', TRUE, '{}'::jsonb),
  ('countrylinqa.regional_discovery', TRUE, '{}'::jsonb),
  ('countrylinqa.global_discovery', TRUE, '{}'::jsonb),
  ('countrylinqa.city_visibility', TRUE, '{"default":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS countrylinqa_user_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_user_audit_user_created ON countrylinqa_user_audit(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS country_community_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  membership_type TEXT NOT NULL DEFAULT 'AUTO' CHECK (membership_type IN ('AUTO','MANUAL','BUSINESS','STAFF')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','SUSPENDED')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, country_code)
);
CREATE INDEX IF NOT EXISTS idx_country_community_memberships_country ON country_community_memberships(country_code, status, joined_at DESC);

CREATE TABLE IF NOT EXISTS region_community_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL REFERENCES geographic_regions(code),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','SUSPENDED')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, region_code)
);

-- minimal, real, empty content stubs: not in any pack, required for the
-- golive ranking queries (business.ts/businessRanking.ts/eventRanking.ts/
-- golive/feed.ts) to run against real tables instead of erroring. No
-- authoring routes are created for these — they stay empty until a real
-- content-creation feature exists.
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_scores (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  rating_score NUMERIC NOT NULL DEFAULT 0,
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED')),
  country_code CHAR(2) REFERENCES countries(code),
  region_code TEXT REFERENCES geographic_regions(code),
  city TEXT,
  popularity_score NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','REMOVED')),
  country_code CHAR(2) REFERENCES countries(code),
  region_code TEXT REFERENCES geographic_regions(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_scores (
  post_id UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  freshness_score NUMERIC NOT NULL DEFAULT 0,
  quality_score NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS business_geo_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('COUNTRY','REGION','STATE')),
  country_code CHAR(2) REFERENCES countries(code),
  region_code TEXT REFERENCES geographic_regions(code),
  state_region TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (target_type='COUNTRY' AND country_code IS NOT NULL AND region_code IS NULL AND state_region IS NULL)
    OR (target_type='REGION' AND region_code IS NOT NULL AND country_code IS NULL AND state_region IS NULL)
    OR (target_type='STATE' AND country_code IS NOT NULL AND state_region IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_business_geo_targets_business ON business_geo_targets(business_id, enabled);
CREATE INDEX IF NOT EXISTS idx_business_geo_targets_country ON business_geo_targets(country_code) WHERE enabled=TRUE;
CREATE INDEX IF NOT EXISTS idx_business_geo_targets_region ON business_geo_targets(region_code) WHERE enabled=TRUE;

CREATE TABLE IF NOT EXISTS countrylinqa_country_status (
  country_code CHAR(2) PRIMARY KEY REFERENCES countries(code),
  discovery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  posting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  business_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  events_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  community_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countrylinqa_region_status (
  region_code TEXT PRIMARY KEY REFERENCES geographic_regions(code),
  discovery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countrylinqa_subscription_snapshots (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('FREE','PREMIUM','ELITE')),
  source TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countrylinqa_preference_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_tier TEXT,
  new_tier TEXT NOT NULL,
  previous_mode TEXT,
  new_mode TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countrylinqa_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_saved_searches_user ON countrylinqa_saved_searches(user_id, enabled, updated_at DESC);

-- ===================== security layer =====================

CREATE TABLE IF NOT EXISTS countrylinqa_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  ip_hash TEXT,
  device_hash TEXT,
  session_id_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_security_events_user ON countrylinqa_security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_security_events_type ON countrylinqa_security_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS countrylinqa_stepup_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  challenge_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_stepup_active ON countrylinqa_stepup_challenges(user_id,purpose,expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS countrylinqa_device_trust (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  trust_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (trust_state IN ('UNKNOWN','TRUSTED','REVIEW','BLOCKED')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(user_id, device_id_hash)
);

CREATE TABLE IF NOT EXISTS countrylinqa_sensitive_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  key_version INTEGER NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_sensitive_evidence_user ON countrylinqa_sensitive_evidence(user_id, evidence_type, created_at DESC);

CREATE TABLE IF NOT EXISTS countrylinqa_policy_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  source_event_id UUID REFERENCES countrylinqa_security_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_policy_actions_active ON countrylinqa_policy_actions(user_id, action_type) WHERE status='ACTIVE';

-- ===================== seed: regions =====================

INSERT INTO geographic_regions (code, name, sort_order) VALUES
  ('AF','Africa',10), ('AF-N','Northern Africa',11), ('AF-W','Western Africa',12),
  ('AF-E','Eastern Africa',13), ('AF-C','Central Africa',14), ('AF-S','Southern Africa',15),
  ('EU','Europe',20), ('NA','North America',30), ('SA','South America',40),
  ('CAR','Caribbean',50), ('ME','Middle East',60), ('CA','Central Asia',70),
  ('SAS','South Asia',80), ('EA','East Asia',90), ('SEA','Southeast Asia',100),
  ('OC','Oceania',110)
ON CONFLICT (code) DO NOTHING;

UPDATE geographic_regions SET parent_code='AF' WHERE code IN ('AF-N','AF-W','AF-E','AF-C','AF-S');

-- ===================== seed: countries =====================

INSERT INTO countries (code, iso3, name, calling_code, region_code) VALUES
  ('US','USA','United States','+1','NA'),
  ('CA','CAN','Canada','+1','NA'),
  ('GB','GBR','United Kingdom','+44','EU'),
  ('GH','GHA','Ghana','+233','AF-W'),
  ('NG','NGA','Nigeria','+234','AF-W'),
  ('DE','DEU','Germany','+49','EU'),
  ('FR','FRA','France','+33','EU'),
  ('AU','AUS','Australia','+61','OC'),
  ('JP','JPN','Japan','+81','EA'),
  ('IN','IND','India','+91','SAS'),
  ('KE','KEN','Kenya','+254','AF-E'),
  ('ZA','ZAF','South Africa','+27','AF-S'),
  ('BR','BRA','Brazil','+55','SA'),
  ('MX','MEX','Mexico','+52','NA')
ON CONFLICT (code) DO NOTHING;

INSERT INTO countrylinqa_country_status (country_code)
  SELECT code FROM countries ON CONFLICT (country_code) DO NOTHING;

INSERT INTO countrylinqa_region_status (region_code)
  SELECT code FROM geographic_regions ON CONFLICT (region_code) DO NOTHING;

COMMIT;
