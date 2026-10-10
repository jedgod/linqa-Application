-- Some databases never received the columns migration 021 adds to user_settings_v2, which made GET /v1/user-settings fail.
-- Re-applying them is harmless where they already exist.
ALTER TABLE user_settings_v2
  ADD COLUMN IF NOT EXISTS live_captions BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_cleanup_media BOOLEAN NOT NULL DEFAULT TRUE;
