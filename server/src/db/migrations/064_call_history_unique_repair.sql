-- Migration 021 is recorded as applied on some databases without its indexes, so ending a call failed on
-- "ON CONFLICT (call_id, user_id)" and no call history was ever written. Re-creating them is harmless where they exist.
CREATE UNIQUE INDEX IF NOT EXISTS call_history_call_user_unique_idx
  ON call_history(call_id, user_id)
  WHERE call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS media_index_object_owner_unique_idx
  ON media_index(user_id, object_key)
  WHERE object_key IS NOT NULL;
