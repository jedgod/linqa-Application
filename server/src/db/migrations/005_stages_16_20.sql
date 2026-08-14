BEGIN;

CREATE TABLE push_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('APNS', 'FCM', 'WEB_PUSH')),
  token_ciphertext BYTEA NOT NULL,
  token_fingerprint BYTEA NOT NULL,
  app_bundle TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('DEVELOPMENT', 'PRODUCTION')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INVALID', 'REVOKED')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, token_fingerprint)
);

CREATE INDEX push_endpoints_device_active_idx
  ON push_endpoints(device_id)
  WHERE status = 'ACTIVE';

CREATE TABLE push_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES push_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'INVALID_TOKEN')
  ),
  provider_message_id TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  message_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  call_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  security_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  preview_mode TEXT NOT NULL DEFAULT 'GENERIC'
    CHECK (preview_mode IN ('NONE', 'GENERIC')),
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_discovery_identifiers (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('PHONE', 'EMAIL')),
  lookup_token BYTEA NOT NULL,
  discoverable BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, identifier_type, lookup_token)
);

CREATE UNIQUE INDEX contact_discovery_lookup_idx
  ON contact_discovery_identifiers(identifier_type, lookup_token)
  WHERE discoverable = TRUE;

CREATE TABLE contact_discovery_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signaling_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL UNIQUE,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  UNIQUE(call_id, device_id)
);

CREATE TABLE signaling_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  sender_device_id UUID NOT NULL REFERENCES devices(id),
  recipient_device_id UUID NOT NULL REFERENCES devices(id),
  sequence BIGINT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'OFFER',
      'ANSWER',
      'ICE_CANDIDATE',
      'ICE_COMPLETE',
      'CALL_ACCEPTED',
      'CALL_REJECTED',
      'CALL_ENDED',
      'RESUME'
    )
  ),
  ciphertext BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(call_id, sender_device_id, sequence)
);

CREATE INDEX signaling_events_delivery_idx
  ON signaling_events(recipient_device_id, call_id, sequence);

CREATE TABLE blocked_users (
  blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE TABLE safety_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  reported_user_id UUID REFERENCES users(id),
  call_id UUID REFERENCES call_sessions(id),
  category TEXT NOT NULL CHECK (
    category IN (
      'HARASSMENT',
      'IMPERSONATION',
      'THREATS',
      'SCAM',
      'SEXUAL_CONTENT',
      'HATE',
      'MINOR_SAFETY',
      'OTHER'
    )
  ),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'TRIAGED', 'INVESTIGATING', 'ACTIONED', 'CLOSED', 'ESCALATED')),
  severity TEXT NOT NULL DEFAULT 'MEDIUM'
    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  assigned_staff_id UUID,
  sla_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE safety_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE,
  submitted_by_user_id UUID NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  evidence_type TEXT NOT NULL CHECK (
    evidence_type IN ('SCREENSHOT', 'RECORDED_VIDEO', 'AUDIO', 'MESSAGE_EXPORT', 'OTHER')
  ),
  encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  user_consented BOOLEAN NOT NULL,
  hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES safety_reports(id),
  target_user_id UUID NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'WARNING',
      'TEMP_RESTRICTION',
      'DEVICE_REVOKE',
      'ACCOUNT_SUSPEND',
      'ACCOUNT_TERMINATE',
      'NO_ACTION'
    )
  ),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  performed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE release_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('WEB', 'DESKTOP', 'ANDROID', 'IOS', 'SERVER', 'CORE')),
  version TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  sha256 BYTEA NOT NULL,
  signature BYTEA NOT NULL,
  sbom_object_key TEXT,
  provenance_object_key TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'REVOKED', 'SUPERSEDED')),
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  UNIQUE(platform, version, artifact_name)
);

CREATE TABLE disaster_recovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('BACKUP', 'RESTORE_TEST', 'FAILOVER_TEST')),
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
