BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('WEB','DESKTOP','ANDROID','IOS')),
  signing_public_key BYTEA NOT NULL,
  encryption_public_key BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, signing_public_key)
);

CREATE INDEX devices_user_status_idx
  ON devices(user_id, status);

CREATE TABLE key_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  package_version INTEGER NOT NULL,
  package_bytes BYTEA NOT NULL,
  package_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  replaced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, package_hash)
);

CREATE UNIQUE INDEX key_packages_active_device_idx
  ON key_packages(device_id)
  WHERE replaced_at IS NULL;

CREATE TABLE message_envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_device_id UUID NOT NULL REFERENCES devices(id),
  recipient_device_id UUID NOT NULL REFERENCES devices(id),
  client_message_id UUID NOT NULL,
  ciphertext BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/linqa-envelope',
  server_sequence BIGSERIAL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  UNIQUE(sender_device_id, client_message_id)
);

CREATE INDEX message_envelopes_delivery_idx
  ON message_envelopes(recipient_device_id, acknowledged_at, lease_expires_at, server_sequence)
  WHERE acknowledged_at IS NULL;

CREATE INDEX message_envelopes_expiry_idx
  ON message_envelopes(expires_at)
  WHERE acknowledged_at IS NULL;

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('001_vertical_slice');

COMMIT;
