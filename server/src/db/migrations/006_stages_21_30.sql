BEGIN;

CREATE TABLE protocol_capabilities (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  protocol_min INTEGER NOT NULL,
  protocol_max INTEGER NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  core_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (protocol_min > 0 AND protocol_max >= protocol_min)
);

CREATE TABLE local_key_rotation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  rotation_type TEXT NOT NULL CHECK (
    rotation_type IN ('DATABASE_KEY', 'SEARCH_INDEX_KEY', 'ATTACHMENT_CACHE_KEY')
  ),
  key_version INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, rotation_type, key_version)
);

CREATE TABLE conversation_retention_policies (
  conversation_id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy TEXT NOT NULL CHECK (
    policy IN ('OFF', 'AFTER_30_SECONDS', 'AFTER_5_MINUTES', 'AFTER_1_HOUR', 'AFTER_1_DAY', 'AFTER_7_DAYS')
  ),
  delete_after_read BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE message_expiry_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  receipt_type TEXT NOT NULL CHECK (
    receipt_type IN ('SCHEDULED', 'EXPIRED_LOCAL', 'DELETED_REMOTE', 'FAILED')
  ),
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, device_id, receipt_type)
);

CREATE TABLE encrypted_voice_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  owner_device_id UUID NOT NULL REFERENCES devices(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 250 AND 600000),
  ciphertext_size BIGINT NOT NULL CHECK (ciphertext_size > 0),
  waveform_ciphertext BYTEA,
  expires_at TIMESTAMPTZ,
  played_at TIMESTAMPTZ,
  deletion_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (deletion_status IN ('ACTIVE', 'QUEUED', 'DELETED', 'PRESERVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usernames (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  normalized_username TEXT NOT NULL UNIQUE,
  display_username TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_change_allowed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE username_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_username TEXT NOT NULL,
  released_at TIMESTAMPTZ,
  reusable_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX username_history_reuse_idx
  ON username_history(normalized_username, reusable_after);

CREATE TABLE privacy_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_visibility TEXT NOT NULL DEFAULT 'CONTACTS'
    CHECK (profile_visibility IN ('EVERYONE', 'CONTACTS', 'NOBODY')),
  phone_discoverability BOOLEAN NOT NULL DEFAULT TRUE,
  email_discoverability BOOLEAN NOT NULL DEFAULT TRUE,
  username_discoverability BOOLEAN NOT NULL DEFAULT TRUE,
  read_receipts BOOLEAN NOT NULL DEFAULT TRUE,
  typing_indicators BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_visibility TEXT NOT NULL DEFAULT 'CONTACTS'
    CHECK (last_seen_visibility IN ('EVERYONE', 'CONTACTS', 'NOBODY')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'BLOCKED')),
  message_ciphertext BYTEA,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sender_user_id, recipient_user_id),
  CHECK (sender_user_id <> recipient_user_id)
);

CREATE TABLE transparency_roots (
  tree_size BIGINT PRIMARY KEY,
  root_hash BYTEA NOT NULL,
  previous_root_hash BYTEA,
  signed_root BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transparency_leaves (
  sequence BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  leaf_hash BYTEA NOT NULL UNIQUE,
  leaf_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transparency_leaves_user_idx
  ON transparency_leaves(user_id, sequence);

CREATE TABLE user_verifications (
  verifier_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  safety_number_hash BYTEA NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalidated_at TIMESTAMPTZ,
  PRIMARY KEY (verifier_user_id, verified_device_id)
);

CREATE TABLE subscription_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT CHECK (provider IN ('APPLE', 'GOOGLE', 'STRIPE', 'MANUAL')),
  customer_reference TEXT,
  status TEXT NOT NULL DEFAULT 'FREE'
    CHECK (status IN ('FREE', 'TRIAL', 'ACTIVE', 'GRACE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
  plan_code TEXT NOT NULL DEFAULT 'FREE',
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entitlements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  source TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entitlement_key)
);

CREATE TABLE billing_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload_hash BYTEA NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSED', 'REJECTED', 'FAILED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE device_reputation (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  registration_failures INTEGER NOT NULL DEFAULT 0,
  spam_events INTEGER NOT NULL DEFAULT 0,
  reports_received INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  allow_user_ids UUID[] NOT NULL DEFAULT '{}',
  deny_user_ids UUID[] NOT NULL DEFAULT '{}',
  minimum_app_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE launch_gates (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'WAIVED', 'PENDING')),
  evidence TEXT,
  owner TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
