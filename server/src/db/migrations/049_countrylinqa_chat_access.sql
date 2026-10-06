-- CountryLinqa chat access control (pack: CountryLinqa_Chat_Access_Control_v5) and first-time activation.
--
-- The pack's NEXT migration targets "countrylinqa_discovery_controls", which does not exist here. The
-- live policy store is country_discovery_preferences (020 + 027), so chat reach extends that table
-- instead of creating a second policy store. Selected chat countries live in a link table like the
-- discovery and inbound ones (so each code is checked against `countries`), not a text[] column.
ALTER TABLE country_discovery_preferences
  ADD COLUMN IF NOT EXISTS chat_reach_mode TEXT NOT NULL DEFAULT 'MY_COUNTRY',
  ADD COLUMN IF NOT EXISTS chat_region_code TEXT REFERENCES geographic_regions(code),
  ADD COLUMN IF NOT EXISTS existing_contacts_bypass_chat_reach BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE country_discovery_preferences DROP CONSTRAINT IF EXISTS countrylinqa_chat_reach_mode_chk;
ALTER TABLE country_discovery_preferences ADD CONSTRAINT countrylinqa_chat_reach_mode_chk
  CHECK (chat_reach_mode IN ('MY_COUNTRY','SELECTED_COUNTRIES','REGION','WORLDWIDE','EXISTING_CONTACTS_ONLY','NOBODY'));

CREATE TABLE IF NOT EXISTS country_chat_links (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country_code)
);
CREATE INDEX IF NOT EXISTS idx_country_chat_links_country ON country_chat_links(country_code, user_id);

-- First-time activation: anyone who already saved CountryLinqa settings has been through setup.
UPDATE country_discovery_preferences SET activated_at = created_at WHERE activated_at IS NULL;
