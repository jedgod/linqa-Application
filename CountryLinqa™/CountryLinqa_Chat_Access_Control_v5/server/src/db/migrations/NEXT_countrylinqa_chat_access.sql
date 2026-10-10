-- Rename NEXT to the next free live migration number.
-- Map table name to the actual table created/extended by migration 027.
ALTER TABLE countrylinqa_discovery_controls
 ADD COLUMN IF NOT EXISTS chat_reach_mode text NOT NULL DEFAULT 'MY_COUNTRY',
 ADD COLUMN IF NOT EXISTS chat_country_codes text[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS chat_region_code text,
 ADD COLUMN IF NOT EXISTS existing_contacts_bypass_chat_reach boolean NOT NULL DEFAULT true;
ALTER TABLE countrylinqa_discovery_controls DROP CONSTRAINT IF EXISTS countrylinqa_chat_reach_mode_chk;
ALTER TABLE countrylinqa_discovery_controls ADD CONSTRAINT countrylinqa_chat_reach_mode_chk
 CHECK(chat_reach_mode IN ('MY_COUNTRY','SELECTED_COUNTRIES','REGION','WORLDWIDE','EXISTING_CONTACTS_ONLY','NOBODY'));
