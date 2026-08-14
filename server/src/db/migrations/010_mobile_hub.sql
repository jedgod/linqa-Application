BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS display_title TEXT,
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0
    CHECK (unread_count >= 0);

CREATE TABLE IF NOT EXISTS user_status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  visibility TEXT NOT NULL DEFAULT 'CONTACTS'
    CHECK (visibility IN ('CONTACTS','CLOSE_FRIENDS','PRIVATE')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_status_updates_active_idx
  ON user_status_updates(user_id, expires_at, created_at DESC);

COMMIT;