BEGIN;

CREATE TABLE IF NOT EXISTS country_discovery_policy_v2 (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  outbound_mode TEXT NOT NULL DEFAULT 'MY_COUNTRY'
    CHECK (outbound_mode IN ('MY_COUNTRY','SELECTED_COUNTRIES','REGION','GLOBAL')),
  inbound_mode TEXT NOT NULL DEFAULT 'MY_COUNTRY'
    CHECK (inbound_mode IN ('MY_COUNTRY','SELECTED_COUNTRIES','REGION','GLOBAL','CONTACTS_ONLY')),
  outbound_country_codes TEXT[] NOT NULL DEFAULT '{}',
  inbound_country_codes TEXT[] NOT NULL DEFAULT '{}',
  outbound_region_code TEXT,
  inbound_region_code TEXT,
  show_country BOOLEAN NOT NULL DEFAULT TRUE,
  show_state BOOLEAN NOT NULL DEFAULT FALSE,
  show_city BOOLEAN NOT NULL DEFAULT FALSE,
  verified_only BOOLEAN NOT NULL DEFAULT TRUE,
  allow_businesses BOOLEAN NOT NULL DEFAULT TRUE,
  allow_communities BOOLEAN NOT NULL DEFAULT TRUE,
  allow_events BOOLEAN NOT NULL DEFAULT TRUE,
  discovery_paused BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS country_discovery_policy_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_policy JSONB,
  new_policy JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'USER_UPDATE',
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_country_discovery_policy_outbound
  ON country_discovery_policy_v2(outbound_mode);

CREATE INDEX IF NOT EXISTS idx_country_discovery_policy_inbound
  ON country_discovery_policy_v2(inbound_mode);

COMMIT;
