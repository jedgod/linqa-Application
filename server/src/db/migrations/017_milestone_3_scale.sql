BEGIN;

CREATE TABLE IF NOT EXISTS federated_user_devices (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  trust_state TEXT NOT NULL CHECK (
    trust_state IN ('PENDING','TRUSTED','REVOKED','RECOVERY_ONLY')
  ),
  device_generation BIGINT NOT NULL DEFAULT 1,
  approved_by_device_id UUID REFERENCES devices(id),
  last_key_rotation_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,device_id)
);

CREATE TABLE IF NOT EXISTS device_sync_cursors_v2 (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  stream_key TEXT NOT NULL,
  cursor BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,device_id,stream_key)
);

CREATE TABLE IF NOT EXISTS group_security_states_v2 (
  group_id UUID PRIMARY KEY,
  current_epoch BIGINT NOT NULL DEFAULT 0,
  encrypted_state BYTEA NOT NULL,
  state_hash BYTEA NOT NULL,
  previous_state_hash BYTEA,
  signer_device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_security_commits_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES group_security_states_v2(group_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL,
  commit_ciphertext BYTEA NOT NULL,
  commit_hash BYTEA NOT NULL,
  signer_device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id,epoch)
);

CREATE TABLE IF NOT EXISTS transparency_proofs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tree_size BIGINT NOT NULL,
  leaf_hash BYTEA NOT NULL,
  inclusion_path BYTEA[] NOT NULL,
  signed_tree_head BYTEA NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_device_tokens_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('APNS','FCM')),
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  token_ciphertext BYTEA NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_delivery_attempts_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('QUEUED','SENT','FAILED_RETRYABLE','FAILED_PERMANENT')
  ),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS turn_regions_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_code TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  healthy BOOLEAN NOT NULL DEFAULT TRUE,
  capacity_score INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FIX (2026-08-07 apply pass): the pack referenced a nonexistent
-- chat_threads(id) FK. The real conversation table (009_gap_closure.sql)
-- is `conversations`.
CREATE TABLE IF NOT EXISTS attachment_delivery_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  cdn_key TEXT NOT NULL UNIQUE,
  encrypted_size BIGINT NOT NULL,
  content_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FIX: the pack referenced a nonexistent organizations_v2(id) FK. The
-- real table (007_three_milestones.sql) is `organizations`.
CREATE TABLE IF NOT EXISTS enterprise_identity_connections_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (
    provider_type IN ('OIDC','SAML','SCIM')
  ),
  provider_name TEXT NOT NULL,
  issuer TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_webhook_events_v2 (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash BYTEA NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADDED (2026-08-07 apply pass): Milestone 3's README assumes a prior
-- "Milestone 2" emergency-contacts feature (emergency_events,
-- emergency_authorizations_v2) that was never actually applied to this
-- repo — no such tables exist anywhere in 001-016. Without them,
-- EmergencyEscalationService's FK would fail to create and its
-- schedule() query would target a nonexistent table. These two tables are
-- the minimal foundation the given escalation code actually needs to be
-- real and testable, not a fabricated larger feature.
CREATE TABLE IF NOT EXISTS emergency_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggered_from_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
    state IN ('ACTIVE','ACKNOWLEDGED','RESOLVED','CANCELLED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS emergency_authorizations_v2 (
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authorized_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_receive_sos BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_user_id,authorized_user_id)
);

CREATE TABLE IF NOT EXISTS emergency_escalation_policies_v2 (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_tier_wait_seconds INTEGER NOT NULL DEFAULT 30,
  second_tier_wait_seconds INTEGER NOT NULL DEFAULT 90,
  escalate_to_staff BOOLEAN NOT NULL DEFAULT FALSE,
  allow_location_share BOOLEAN NOT NULL DEFAULT TRUE,
  allow_video_share BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_escalation_steps_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_event_id UUID NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  recipient_user_id UUID REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (
    target_type IN ('TRUSTED_CONTACT','STAFF','EMERGENCY_SERVICE')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING','NOTIFIED','ACKNOWLEDGED','FAILED','SKIPPED')
  ),
  scheduled_for TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS emergency_escalation_due_idx
  ON emergency_escalation_steps_v2(status,scheduled_for)
  WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS canary_releases_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_version TEXT NOT NULL,
  environment TEXT NOT NULL,
  rollout_percentage INTEGER NOT NULL CHECK (rollout_percentage BETWEEN 0 AND 100),
  state TEXT NOT NULL CHECK (
    state IN ('CREATED','RUNNING','PAUSED','PROMOTED','ROLLED_BACK','FAILED')
  ),
  error_budget_threshold NUMERIC(6,4) NOT NULL DEFAULT 0.0100,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
