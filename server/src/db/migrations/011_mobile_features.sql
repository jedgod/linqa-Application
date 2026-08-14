BEGIN;

CREATE TABLE IF NOT EXISTS user_status_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('TEXT','IMAGE','VIDEO','VOICE')),
  content_ciphertext BYTEA NOT NULL,
  privacy TEXT NOT NULL CHECK (privacy IN ('CONTACTS','CLOSE_FRIENDS','CUSTOM')),
  custom_audience_user_ids UUID[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_status_posts_active_idx
  ON user_status_posts(user_id,expires_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS scheduled_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_user_ids UUID[] NOT NULL,
  call_type TEXT NOT NULL CHECK (call_type IN ('AUDIO','VIDEO')),
  privacy_mode TEXT NOT NULL CHECK (privacy_mode IN ('STANDARD','RELAY_ONLY')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  title_ciphertext BYTEA,
  status TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','STARTED','CANCELLED','COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
