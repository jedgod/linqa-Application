BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('WEB', 'DESKTOP', 'ANDROID', 'IOS')),
  signing_public_key BYTEA NOT NULL,
  encryption_public_key BYTEA NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  registered_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, signing_public_key)
);

CREATE INDEX devices_user_status_idx ON devices(user_id, status);

CREATE TABLE device_registration_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX device_registration_challenges_expiry_idx
  ON device_registration_challenges(expires_at)
  WHERE consumed_at IS NULL;

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

CREATE TABLE key_transparency_events (
  sequence BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('DEVICE_REGISTERED', 'DEVICE_REVOKED', 'KEY_PACKAGE_PUBLISHED', 'KEY_PACKAGE_REPLACED')
  ),
  object_hash BYTEA NOT NULL,
  previous_event_hash BYTEA,
  event_hash BYTEA NOT NULL UNIQUE,
  event_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX key_transparency_events_user_sequence_idx
  ON key_transparency_events(user_id, sequence);

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

CREATE TABLE device_sync_cursors (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  last_acknowledged_sequence BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  request_id TEXT,
  ip_hash BYTEA,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_actor_created_idx
  ON audit_events(actor_user_id, created_at DESC);

COMMIT;
