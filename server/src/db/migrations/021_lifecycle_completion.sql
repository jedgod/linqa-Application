BEGIN;

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS call_type TEXT NOT NULL DEFAULT 'AUDIO'
  CHECK (call_type IN ('AUDIO','VIDEO','SCREEN_SHARE'));

CREATE UNIQUE INDEX IF NOT EXISTS call_history_call_user_unique_idx
  ON call_history(call_id, user_id)
  WHERE call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS media_index_object_owner_unique_idx
  ON media_index(user_id, object_key)
  WHERE object_key IS NOT NULL;

ALTER TABLE user_settings_v2
  ADD COLUMN IF NOT EXISTS live_captions BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_cleanup_media BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;