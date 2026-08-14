BEGIN;

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
  ON webauthn_credentials(user_id) WHERE revoked_at IS NULL;

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

CREATE TABLE IF NOT EXISTS vault_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (
    item_type IN ('DOCUMENT','IDENTITY','PHOTO','RECOVERY','OTHER')
  ),
  name_ciphertext BYTEA NOT NULL,
  metadata_ciphertext BYTEA NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_hash BYTEA NOT NULL,
  encrypted_size BIGINT NOT NULL CHECK (encrypted_size >= 0),
  key_envelope BYTEA NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_items_user_idx
  ON vault_items(user_id,created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS backup_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_device_id UUID NOT NULL REFERENCES devices(id),
  manifest_ciphertext BYTEA NOT NULL,
  manifest_hash BYTEA NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  backup_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UPLOADING','READY','FAILED','DELETED')),
  sequence BIGINT,
  previous_manifest_hash BYTEA,
  signature BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS backup_sequences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latest_sequence BIGINT NOT NULL DEFAULT 0 CHECK (latest_sequence >= 0),
  latest_manifest_hash BYTEA,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS backup_manifest_user_sequence_idx
  ON backup_manifests(user_id,sequence) WHERE sequence IS NOT NULL;

CREATE TABLE IF NOT EXISTS secure_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  logical_clock BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS secure_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  logical_clock BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS lifecycle_idempotency (
  key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transparency_tree_heads (
  tree_size BIGINT PRIMARY KEY CHECK (tree_size > 0),
  root_hash BYTEA NOT NULL,
  signature BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mls_group_states (
  group_id UUID PRIMARY KEY,
  epoch BIGINT NOT NULL CHECK (epoch >= 0),
  state_ciphertext BYTEA NOT NULL,
  state_hash BYTEA NOT NULL,
  previous_state_hash BYTEA,
  signer_device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mls_commit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES mls_group_states(group_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL CHECK (epoch > 0),
  commit_ciphertext BYTEA NOT NULL,
  commit_hash BYTEA NOT NULL,
  signer_device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id,epoch)
);

CREATE TABLE IF NOT EXISTS abuse_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW','CHALLENGE','THROTTLE','DENY')),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abuse_decisions_time_idx
  ON abuse_decisions(created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_rate_limits (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  requests_per_minute INTEGER NOT NULL DEFAULT 600 CHECK (requests_per_minute > 0),
  burst INTEGER NOT NULL DEFAULT 1200 CHECK (burst > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operational_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_subject TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','HIGH','CRITICAL')),
  target_type TEXT,
  target_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_audit_events_time_idx
  ON operational_audit_events(created_at DESC);

INSERT INTO milestone_feature_flags (
  key,milestone_code,enabled,rollout_percentage,metadata
) VALUES
  ('secureMessaging','1.0',FALSE,0,'{"owner":"messaging","gate":"independent-review"}'),
  ('fileVault','1.0',FALSE,0,'{"owner":"storage","gate":"kms-storage-validation"}'),
  ('cloudBackup','1.0',FALSE,0,'{"owner":"recovery","gate":"restore-verification"}'),
  ('secureNotes','2.0',FALSE,0,'{"owner":"collaboration"}'),
  ('secureCalendar','2.0',FALSE,0,'{"owner":"collaboration"}'),
  ('passkeys','1.0',FALSE,0,'{"owner":"identity"}'),
  ('enterpriseScim','3.0',FALSE,0,'{"owner":"enterprise"}')
ON CONFLICT (key) DO NOTHING;

COMMIT;