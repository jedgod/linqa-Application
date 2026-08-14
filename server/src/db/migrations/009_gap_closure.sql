BEGIN;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_object_key TEXT,
  bio TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
  enrollment_status TEXT NOT NULL CHECK (
    enrollment_status IN ('PENDING','VERIFIED','REJECTED','REVOKED')
  ),
  enrollment_proof BYTEA NOT NULL,
  proof_hash BYTEA NOT NULL,
  verified_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_type TEXT NOT NULL CHECK (
    conversation_type IN ('DIRECT','GROUP','COMMUNITY','BUSINESS')
  ),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  title_ciphertext BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id,user_id)
);

CREATE TABLE IF NOT EXISTS client_message_state (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  sender_device_id UUID NOT NULL REFERENCES devices(id),
  state TEXT NOT NULL CHECK (
    state IN ('DRAFT','ENCRYPTING','QUEUED','UPLOADING','ACCEPTED_BY_RELAY','DELIVERED','READ','FAILED_RETRYABLE','FAILED_PERMANENT','EXPIRED')
  ),
  relay_envelope_id UUID,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_message_state_outbox_idx
ON client_message_state(sender_device_id,state,updated_at)
WHERE state IN ('QUEUED','FAILED_RETRYABLE');

CREATE TABLE IF NOT EXISTS call_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INCOMING','OUTGOING')),
  call_type TEXT NOT NULL CHECK (call_type IN ('AUDIO','VIDEO','SCREEN_SHARE')),
  status TEXT NOT NULL CHECK (status IN ('MISSED','REJECTED','COMPLETED','FAILED','CANCELLED')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_history_user_time_idx
ON call_history(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS media_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID,
  media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','VIDEO','VOICE_NOTE','DOCUMENT','LINK','FILE')),
  object_key TEXT,
  thumbnail_object_key TEXT,
  metadata_ciphertext BYTEA,
  starred BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_preferences_v2 (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages BOOLEAN NOT NULL DEFAULT TRUE,
  calls BOOLEAN NOT NULL DEFAULT TRUE,
  communities BOOLEAN NOT NULL DEFAULT TRUE,
  business BOOLEAN NOT NULL DEFAULT TRUE,
  mentions_only BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT,
  priority_contact_ids UUID[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings_v2 (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM','LIGHT','DARK')),
  font_scale NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  reduced_motion BOOLEAN NOT NULL DEFAULT FALSE,
  high_contrast BOOLEAN NOT NULL DEFAULT FALSE,
  default_disappearing_policy TEXT NOT NULL DEFAULT 'OFF',
  auto_download_media BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_call_quality TEXT NOT NULL DEFAULT 'AUTO' CHECK (preferred_call_quality IN ('AUTO','LOW','STANDARD','HD','ULTRA_HD')),
  relay_only_calls BOOLEAN NOT NULL DEFAULT FALSE,
  ai_mode TEXT NOT NULL DEFAULT 'DISABLED' CHECK (ai_mode IN ('DISABLED','ON_DEVICE','CONFIDENTIAL_CLOUD')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
