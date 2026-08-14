BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS device_installations_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_public_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (
    platform IN ('IOS','ANDROID','WEB','WINDOWS','MACOS','LINUX')
  ),
  app_instance_public_key BYTEA,
  trust_state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (trust_state IN ('PENDING','TRUSTED','REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installation_accounts_v2 (
  installation_id UUID NOT NULL
    REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_slot SMALLINT NOT NULL CHECK (account_slot BETWEEN 1 AND 3),
  label TEXT,
  state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE','LOCKED','REMOVED')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY(installation_id,user_id),
  UNIQUE(installation_id,account_slot)
);

CREATE UNIQUE INDEX IF NOT EXISTS installation_accounts_active_slot_idx
  ON installation_accounts_v2(installation_id,account_slot)
  WHERE state='ACTIVE';

CREATE TABLE IF NOT EXISTS phone_identities_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  country_iso2 TEXT NOT NULL,
  e164_ciphertext BYTEA NOT NULL,
  e164_hash BYTEA NOT NULL UNIQUE,
  national_number_suffix TEXT,
  verification_state TEXT NOT NULL CHECK (
    verification_state IN (
      'PENDING',
      'OTP_REQUIRED',
      'VERIFIED_MOBILE',
      'REVIEW_REQUIRED',
      'REJECTED_VIRTUAL',
      'REJECTED_INVALID',
      'REJECTED_RISK',
      'REVOKED'
    )
  ),
  line_type TEXT,
  carrier_name TEXT,
  carrier_country TEXT,
  mobile_country_code TEXT,
  mobile_network_code TEXT,
  provider_reference TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS phone_verification_assessments_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_identity_id UUID NOT NULL
    REFERENCES phone_identities_v2(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  line_type TEXT,
  disposable BOOLEAN,
  voip BOOLEAN,
  hosted BOOLEAN,
  valid BOOLEAN,
  carrier_name TEXT,
  country_iso2 TEXT,
  ported BOOLEAN,
  sim_swap_risk TEXT,
  raw_risk_score INTEGER CHECK (raw_risk_score BETWEEN 0 AND 100),
  normalized_risk_score INTEGER CHECK (normalized_risk_score BETWEEN 0 AND 100),
  decision TEXT NOT NULL CHECK (
    decision IN ('ALLOW','REVIEW','REJECT')
  ),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mobile_otp_challenges_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_identity_id UUID NOT NULL
    REFERENCES phone_identities_v2(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('SMS','VOICE')),
  destination_hash BYTEA NOT NULL,
  code_hash BYTEA NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  send_count INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  max_sends INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_otp_active_idx
  ON mobile_otp_challenges_v2(phone_identity_id,expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS account_switch_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL
    REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'USER_SWITCH',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_switch_events_installation_idx
  ON account_switch_events_v2(installation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS account_push_bindings_v2 (
  installation_id UUID NOT NULL
    REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('APNS','FCM','WEB_PUSH')),
  token_hash BYTEA NOT NULL,
  token_ciphertext BYTEA NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(installation_id,user_id,provider)
);

CREATE TABLE IF NOT EXISTS account_storage_namespaces_v2 (
  installation_id UUID NOT NULL
    REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  namespace_id UUID NOT NULL DEFAULT gen_random_uuid(),
  key_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(installation_id,user_id),
  UNIQUE(namespace_id),
  UNIQUE(installation_id,key_alias)
);

CREATE TABLE IF NOT EXISTS account_limit_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL
    REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  attempted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'ACCOUNT_ADDED',
      'ACCOUNT_REMOVED',
      'ACCOUNT_LIMIT_REJECTED',
      'NUMBER_REJECTED',
      'NUMBER_REVIEW_REQUIRED'
    )
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
