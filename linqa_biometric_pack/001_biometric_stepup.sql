BEGIN;

CREATE TABLE IF NOT EXISTS biometric_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('IOS','ANDROID')),
  algorithm text NOT NULL CHECK (algorithm IN ('P256_SHA256')),
  public_key_spki bytea NOT NULL,
  key_alias text NOT NULL,
  biometric_class text NOT NULL CHECK (biometric_class IN ('STRONG')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(user_id, device_id, key_alias)
);

CREATE INDEX IF NOT EXISTS biometric_credentials_active_idx
ON biometric_credentials(user_id, device_id)
WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS biometric_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  credential_id uuid NOT NULL REFERENCES biometric_credentials(id),
  purpose text NOT NULL,
  resource_hash bytea NOT NULL,
  challenge_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  risk_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS biometric_challenges_pending_idx
ON biometric_challenges(user_id, device_id, expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS biometric_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  credential_id uuid NOT NULL REFERENCES biometric_credentials(id),
  purpose text NOT NULL,
  resource_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS biometric_grants_pending_idx
ON biometric_grants(user_id, purpose, expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS biometric_audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid,
  device_id uuid,
  credential_id uuid,
  event_type text NOT NULL,
  purpose text,
  resource_hash_hex text,
  success boolean NOT NULL,
  reason text,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
