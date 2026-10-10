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
BEGIN;
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS installation_id uuid;
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS security_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE biometric_credentials ADD CONSTRAINT biometric_credentials_state_ck CHECK (state IN ('PENDING','ACTIVE','SUSPENDED','REVOKED'));
ALTER TABLE biometric_challenges ADD COLUMN IF NOT EXISTS installation_id uuid;
ALTER TABLE biometric_grants ADD COLUMN IF NOT EXISTS installation_id uuid;
CREATE INDEX IF NOT EXISTS biometric_credentials_installation_idx ON biometric_credentials(user_id,installation_id,device_id) WHERE revoked_at IS NULL;
COMMIT;
BEGIN;
ALTER TABLE biometric_challenges ADD COLUMN IF NOT EXISTS resource_version bigint NOT NULL DEFAULT 1;
ALTER TABLE biometric_grants ADD COLUMN IF NOT EXISTS resource_version bigint NOT NULL DEFAULT 1;
ALTER TABLE biometric_grants ADD COLUMN IF NOT EXISTS security_epoch integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS biometric_idempotency (
  user_id uuid NOT NULL, scope text NOT NULL, idempotency_key text NOT NULL,
  request_hash bytea NOT NULL, response_json jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,scope,idempotency_key)
);
COMMIT;
BEGIN;
CREATE TABLE IF NOT EXISTS biometric_security_state(
 user_id uuid PRIMARY KEY, security_epoch integer NOT NULL DEFAULT 1,
 locked_until timestamptz, recovery_in_progress boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS biometric_outbox(
 id uuid PRIMARY KEY, event_type text NOT NULL, aggregate_id text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, last_error text
);
ALTER TABLE biometric_audit_events ADD COLUMN IF NOT EXISTS previous_hash bytea;
ALTER TABLE biometric_audit_events ADD COLUMN IF NOT EXISTS event_hash bytea;
COMMIT;
BEGIN;
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS attestation_status text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS attested_at timestamptz;
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS attestation_key_id text;
ALTER TABLE biometric_credentials ADD CONSTRAINT biometric_attestation_status_ck CHECK(attestation_status IN('UNKNOWN','VERIFIED','FAILED','STALE','NOT_SUPPORTED'));
ALTER TABLE biometric_challenges ADD COLUMN IF NOT EXISTS security_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE biometric_challenges ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE biometric_grants ADD COLUMN IF NOT EXISTS session_id text;
CREATE TABLE IF NOT EXISTS biometric_attestation_events(
 id uuid PRIMARY KEY,user_id uuid NOT NULL,device_id uuid NOT NULL,credential_id uuid,
 platform text NOT NULL,provider text NOT NULL,verdict text NOT NULL,reason text,
 evidence_digest bytea,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biometric_grants_strict_idx ON biometric_grants(user_id,device_id,purpose,expires_at) WHERE consumed_at IS NULL;
COMMIT;
