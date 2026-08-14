BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- WebAuthn/Passkey support
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('REGISTRATION','AUTHENTICATION')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  webauthn_user_id BYTEA NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_type TEXT NOT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  nickname TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx
  ON webauthn_credentials(user_id)
  WHERE revoked_at IS NULL;

-- Enrollment V2 challenges for device approval
CREATE TABLE IF NOT EXISTS enrollment_challenges_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approving_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  requested_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  challenge BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization-scoped API grants for SCIM/enterprise
CREATE TABLE IF NOT EXISTS organization_api_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,subject)
);

-- File Vault encrypted storage
CREATE TABLE IF NOT EXISTS vault_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (
    item_type IN ('DOCUMENT','IDENTITY','PHOTO','RECOVERY','OTHER')
  ),
  name_ciphertext BYTEA NOT NULL,
  metadata_ciphertext BYTEA NOT NULL,
  object_key TEXT NOT NULL,
  content_hash BYTEA NOT NULL,
  encrypted_size BIGINT NOT NULL CHECK (encrypted_size >= 0),
  key_envelope BYTEA NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_items_user_idx
  ON vault_items(user_id,created_at DESC)
  WHERE deleted_at IS NULL;

-- Backup manifest foundation
CREATE TABLE IF NOT EXISTS backup_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_device_id UUID NOT NULL REFERENCES devices(id),
  manifest_ciphertext BYTEA NOT NULL,
  manifest_hash BYTEA NOT NULL,
  object_key TEXT NOT NULL,
  backup_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('UPLOADING','READY','FAILED','DELETED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Secure notes foundation
CREATE TABLE IF NOT EXISTS secure_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  logical_clock BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Secure calendar events foundation
CREATE TABLE IF NOT EXISTS secure_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  logical_clock BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lifecycle event idempotency
CREATE TABLE IF NOT EXISTS lifecycle_idempotency (
  key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed comprehensive feature flags
INSERT INTO milestone_feature_flags (
  key,milestone_code,enabled,rollout_percentage,metadata
) VALUES
  ('secureMessaging','1.0',FALSE,0,'{"owner":"messaging"}'),
  ('fileVault','1.0',FALSE,0,'{"owner":"storage"}'),
  ('cloudBackup','1.0',FALSE,0,'{"owner":"recovery"}'),
  ('secureNotes','2.0',FALSE,0,'{"owner":"collaboration"}'),
  ('secureCalendar','2.0',FALSE,0,'{"owner":"collaboration"}'),
  ('passkeys','1.0',FALSE,0,'{"owner":"identity"}'),
  ('enterpriseScim','3.0',FALSE,0,'{"owner":"enterprise"}')
ON CONFLICT (key) DO NOTHING;

COMMIT;
