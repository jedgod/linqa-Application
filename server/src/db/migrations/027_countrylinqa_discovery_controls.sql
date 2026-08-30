DO $$ BEGIN
  CREATE TYPE country_inbound_reach AS ENUM (
    'MY_COUNTRY', 'SELECTED_COUNTRIES', 'REGION', 'GLOBAL', 'CONTACTS_ONLY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE country_discovery_preferences
  ADD COLUMN IF NOT EXISTS inbound_reach country_inbound_reach NOT NULL DEFAULT 'MY_COUNTRY',
  ADD COLUMN IF NOT EXISTS show_country BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_state BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_only BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_businesses BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_communities BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_events BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS country_inbound_links (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country_code)
);

CREATE TABLE IF NOT EXISTS regional_inbound_links (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL REFERENCES geographic_regions(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, region_code)
);

CREATE INDEX IF NOT EXISTS idx_country_inbound_links_country
  ON country_inbound_links(country_code, user_id);
CREATE INDEX IF NOT EXISTS idx_regional_inbound_links_region
  ON regional_inbound_links(region_code, user_id);

COMMENT ON COLUMN country_discovery_preferences.mode IS
  'Outbound reach: who this user can discover. This never changes verified country identity.';
COMMENT ON COLUMN country_discovery_preferences.inbound_reach IS
  'Inbound reach: who may discover this user. CONTACTS_ONLY disables new geographic discovery.';
COMMENT ON COLUMN country_discovery_preferences.enabled IS
  'False pauses new CountryLinqa discovery while preserving established connections.';
