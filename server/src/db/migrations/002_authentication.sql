BEGIN;

CREATE TABLE account_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PHONE', 'EMAIL')),
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(type, normalized_value)
);

CREATE UNIQUE INDEX account_identifiers_primary_per_type_idx
  ON account_identifiers(user_id, type)
  WHERE is_primary = TRUE AND disabled_at IS NULL;

CREATE TABLE authentication_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('PHONE', 'EMAIL')),
  normalized_identifier TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('REGISTRATION', 'LOGIN', 'ADD_IDENTIFIER', 'RECOVERY', 'HIGH_RISK_ACTION')
  ),
  channel TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL')),
  code_hash BYTEA NOT NULL,
  code_salt BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  resend_after TIMESTAMPTZ NOT NULL,
  attempts_remaining INTEGER NOT NULL CHECK (attempts_remaining >= 0),
  consumed_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  requesting_ip_hash BYTEA,
  requesting_user_agent_hash BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX authentication_challenges_lookup_idx
  ON authentication_challenges(normalized_identifier, purpose, created_at DESC);

CREATE INDEX authentication_challenges_expiry_idx
  ON authentication_challenges(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE registration_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL UNIQUE REFERENCES authentication_challenges(id) ON DELETE CASCADE,
  normalized_identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('PHONE', 'EMAIL')),
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE passkey_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id BYTEA NOT NULL UNIQUE,
  public_key_cose BYTEA NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  nickname TEXT,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  token_family_id UUID NOT NULL,
  refresh_token_hash BYTEA NOT NULL UNIQUE,
  previous_refresh_token_hash BYTEA,
  access_scope TEXT[] NOT NULL DEFAULT '{}',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  ip_hash BYTEA,
  user_agent_hash BYTEA
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX auth_sessions_family_idx
  ON auth_sessions(token_family_id);

CREATE TABLE recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash BYTEA NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  normalized_identifier TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'HOLD', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')
  ),
  risk_score INTEGER NOT NULL DEFAULT 0,
  hold_until TIMESTAMPTZ,
  requested_ip_hash BYTEA,
  requested_user_agent_hash BYTEA,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE security_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
