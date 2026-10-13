-- Protected photos: ciphertext only. The decryption key travels inside the
-- end-to-end encrypted chat message and never reaches the server.

CREATE TABLE IF NOT EXISTS protected_media (
  id UUID PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID,
  mode TEXT NOT NULL CHECK (mode IN ('MULTI_VIEW', 'TIMED', 'EPHEMERAL')),
  max_views INTEGER CHECK (max_views IS NULL OR max_views > 0),
  window_seconds INTEGER,
  expiry_start TEXT CHECK (expiry_start IS NULL OR expiry_start IN ('ON_SEND', 'ON_FIRST_VIEW')),
  view_seconds INTEGER NOT NULL,
  notify_on_view BOOLEAN NOT NULL DEFAULT TRUE,
  revoke_on_capture BOOLEAN NOT NULL DEFAULT FALSE,
  blob BYTEA,
  size_bytes INTEGER NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REVOKED', 'CAPTURE_REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_viewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS protected_media_active_idx ON protected_media(status, expires_at);
CREATE INDEX IF NOT EXISTS protected_media_sender_idx ON protected_media(sender_id);
CREATE INDEX IF NOT EXISTS protected_media_recipient_idx ON protected_media(recipient_id);

CREATE TABLE IF NOT EXISTS protected_media_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES protected_media(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_number INTEGER NOT NULL,
  -- SHA-256 of the single-use download token. The token itself is never stored.
  token_hash TEXT NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  blob_fetched_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT
);
CREATE INDEX IF NOT EXISTS protected_media_views_media_idx ON protected_media_views(media_id);

-- Append-only, hash-chained audit log. It outlives the media so the trail stays reviewable.
CREATE TABLE IF NOT EXISTS protected_media_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES protected_media(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_id UUID,
  view_number INTEGER,
  at TIMESTAMPTZ NOT NULL,
  detail JSONB,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  UNIQUE (media_id, seq)
);
