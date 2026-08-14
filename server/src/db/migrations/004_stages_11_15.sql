BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (deletion_status IN (
      'ACTIVE',
      'PENDING_DELETION',
      'DELETION_LOCKED',
      'DELETING',
      'DELETED',
      'RECOVERY_HOLD'
    )),
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_execute_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactivity_delete_months INTEGER
    CHECK (inactivity_delete_months IN (6, 12, 24)),
  ADD COLUMN IF NOT EXISTS last_authenticated_at TIMESTAMPTZ;

CREATE TABLE account_deletion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('SCHEDULED', 'RUNNING', 'RETRY', 'COMPLETED', 'CANCELLED', 'BLOCKED')
  ),
  execute_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX account_deletion_jobs_due_idx
  ON account_deletion_jobs(execute_at)
  WHERE status IN ('SCHEDULED', 'RETRY');

CREATE TABLE call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_user_id UUID NOT NULL REFERENCES users(id),
  initiator_device_id UUID NOT NULL REFERENCES devices(id),
  mode TEXT NOT NULL CHECK (mode IN ('LIVE', 'RECORDED_RESPONSE')),
  status TEXT NOT NULL CHECK (
    status IN ('CREATED', 'RINGING', 'ACTIVE', 'ENDED', 'FAILED', 'CANCELLED')
  ),
  privacy_mode TEXT NOT NULL CHECK (privacy_mode IN ('STANDARD', 'RELAY_ONLY')),
  location_exchange_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  retention_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE call_participants (
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  role TEXT NOT NULL CHECK (role IN ('CALLER', 'CALLEE')),
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  PRIMARY KEY (call_id, device_id)
);

CREATE TABLE recorded_video_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  owner_device_id UUID NOT NULL REFERENCES devices(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_size BIGINT NOT NULL CHECK (ciphertext_size > 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  disclosure_version INTEGER NOT NULL DEFAULT 1,
  retention_policy TEXT NOT NULL CHECK (
    retention_policy IN ('VIEW_ONCE', 'DELETE_AFTER_VIEW', 'DELETE_24_HOURS', 'DELETE_7_DAYS', 'KEEP')
  ),
  expires_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  deletion_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (deletion_status IN ('ACTIVE', 'QUEUED', 'DELETED', 'PRESERVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE call_retention_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  call_history_policy TEXT NOT NULL DEFAULT 'DELETE_7_DAYS'
    CHECK (call_history_policy IN ('IMMEDIATE', 'DELETE_24_HOURS', 'DELETE_7_DAYS', 'KEEP')),
  recorded_video_policy TEXT NOT NULL DEFAULT 'DELETE_7_DAYS'
    CHECK (recorded_video_policy IN ('VIEW_ONCE', 'DELETE_AFTER_VIEW', 'DELETE_24_HOURS', 'DELETE_7_DAYS', 'KEEP')),
  diagnostics_policy TEXT NOT NULL DEFAULT 'DELETE_7_DAYS'
    CHECK (diagnostics_policy IN ('MINIMAL', 'DELETE_24_HOURS', 'DELETE_7_DAYS')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE retention_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('SAFETY_REPORT', 'LEGAL_HOLD', 'SECURITY_INCIDENT')),
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE(resource_type, resource_id, reason)
);

CREATE TABLE call_location_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  mode TEXT NOT NULL CHECK (mode IN ('CITY', 'APPROXIMATE', 'PRECISE')),
  scope TEXT NOT NULL CHECK (scope IN ('CALL_ONLY', 'MINUTES_15', 'HOUR_1')),
  foreground_only BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED', 'DECLINED')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(call_id, device_id)
);

CREATE TABLE encrypted_location_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  sender_device_id UUID NOT NULL REFERENCES devices(id),
  ciphertext BYTEA NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX encrypted_location_events_call_sequence_idx
  ON encrypted_location_events(call_id, sequence);

CREATE TABLE network_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('VPN_DETECTED', 'PROXY_DETECTED', 'ASN_CHANGED', 'COUNTRY_CHANGED', 'IMPOSSIBLE_TRAVEL')
  ),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
