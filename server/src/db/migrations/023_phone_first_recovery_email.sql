BEGIN;

CREATE TABLE IF NOT EXISTS recovery_email_identities_v3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_ciphertext BYTEA NOT NULL,
  email_hash BYTEA NOT NULL UNIQUE,
  masked_email TEXT NOT NULL,
  verification_state TEXT NOT NULL CHECK (
    verification_state IN ('OTP_REQUIRED','VERIFIED','REVOKED')
  ),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_email_otp_challenges_v3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_email_identity_id UUID NOT NULL
    REFERENCES recovery_email_identities_v3(id) ON DELETE CASCADE,
  code_hash BYTEA NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_email_otp_active_idx
  ON recovery_email_otp_challenges_v3(recovery_email_identity_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS registration_flows_v3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provisional_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id UUID NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN (
    'STARTED','PHONE_OTP_REQUIRED','PHONE_REVIEW_REQUIRED',
    'RECOVERY_EMAIL_REQUIRED','EMAIL_OTP_REQUIRED',
    'RECOVERY_EMAIL_VERIFIED','ACCOUNT_ACTIVATED','FAILED','CANCELLED'
  )),
  detected_country_iso2 TEXT,
  selected_country_iso2 TEXT,
  phone_identity_id UUID REFERENCES phone_identities_v2(id) ON DELETE SET NULL,
  recovery_email_identity_id UUID REFERENCES recovery_email_identities_v3(id) ON DELETE SET NULL,
  account_slot SMALLINT CHECK (account_slot BETWEEN 1 AND 3),
  failure_code TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS registration_flows_active_user_installation_idx
  ON registration_flows_v3(provisional_user_id, installation_id)
  WHERE state NOT IN ('ACCOUNT_ACTIVATED','FAILED','CANCELLED');

CREATE TABLE IF NOT EXISTS trusted_installation_devices_v3 (
  installation_id UUID NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  trust_state TEXT NOT NULL CHECK (trust_state IN ('TRUSTED','REVOKED')),
  trust_method TEXT NOT NULL,
  trusted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY(installation_id,user_id,device_id)
);

CREATE TABLE IF NOT EXISTS account_crypto_namespaces_v3 (
  installation_id UUID NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  namespace_id UUID NOT NULL DEFAULT gen_random_uuid(),
  identity_key_alias TEXT NOT NULL,
  vault_key_alias TEXT NOT NULL,
  backup_key_alias TEXT NOT NULL,
  local_db_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(installation_id,user_id),
  UNIQUE(namespace_id),
  UNIQUE(installation_id,local_db_name)
);

CREATE TABLE IF NOT EXISTS active_account_context_v3 (
  installation_id UUID PRIMARY KEY REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  active_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  switched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity_security_events_v3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  installation_id UUID REFERENCES device_installations_v2(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  risk_score INTEGER CHECK (risk_score BETWEEN 0 AND 100),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
