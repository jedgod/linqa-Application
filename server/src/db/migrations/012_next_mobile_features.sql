BEGIN;

CREATE TABLE IF NOT EXISTS message_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_envelope_id UUID,
  preview_ciphertext BYTEA NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'LOW'
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  mutual_contacts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','DECLINED','BLOCKED','REPORTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(sender_user_id,recipient_user_id)
);

CREATE INDEX IF NOT EXISTS message_requests_recipient_idx
  ON message_requests(recipient_user_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS status_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES user_status_posts(id) ON DELETE CASCADE,
  reactor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(status_id,reactor_user_id)
);

CREATE TABLE IF NOT EXISTS status_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES user_status_posts(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_mutes (
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_user_id,muted_user_id)
);

CREATE TABLE IF NOT EXISTS device_security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (
    alert_type IN ('NEW_DEVICE','RISKY_SESSION','KEY_CHANGED','DEVICE_REVOKED')
  ),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_security_alerts_user_idx
  ON device_security_alerts(user_id,acknowledged_at,created_at DESC);

CREATE TABLE IF NOT EXISTS storage_usage_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  encrypted_media_bytes BIGINT NOT NULL DEFAULT 0,
  cache_bytes BIGINT NOT NULL DEFAULT 0,
  database_bytes BIGINT NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
