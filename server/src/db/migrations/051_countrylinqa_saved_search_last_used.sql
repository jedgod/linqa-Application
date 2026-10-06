-- Saved Searches shows when each one was last opened ("Last used yesterday").
ALTER TABLE countrylinqa_saved_searches ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
