BEGIN;
-- Adapted from the v5 consolidated pack; principals reference Linqa's existing tables.
CREATE TABLE biometric_security_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  security_epoch integer NOT NULL DEFAULT 1 CHECK (security_epoch > 0),
  recovery_in_progress boolean NOT NULL DEFAULT false,
  locked_until timestamptz, audit_head bytea, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE biometric_enrollment_requests (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  nonce_hash bytea NOT NULL, security_epoch integer NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE biometric_credentials (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('IOS','ANDROID')),
  algorithm text NOT NULL DEFAULT 'P256_SHA256' CHECK (algorithm='P256_SHA256'),
  public_key_spki bytea NOT NULL, key_alias text NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','SUSPENDED','REVOKED')),
  security_epoch integer NOT NULL, attestation_status text NOT NULL CHECK (attestation_status IN ('VERIFIED','NOT_SUPPORTED')),
  attestation_provider text NOT NULL, enrolled_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz,
  UNIQUE (user_id,installation_id,device_id,key_alias)
);
CREATE TABLE biometric_challenges (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES biometric_credentials(id),
  purpose text NOT NULL, resource_hash bytea NOT NULL, resource_version bigint NOT NULL DEFAULT 1,
  challenge_hash bytea NOT NULL UNIQUE, security_epoch integer NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE biometric_grants (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES biometric_credentials(id),
  purpose text NOT NULL, resource_hash bytea NOT NULL, resource_version bigint NOT NULL DEFAULT 1,
  security_epoch integer NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE biometric_vault_sessions (
  token_hash bytea PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES device_installations_v2(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES biometric_credentials(id), security_epoch integer NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE biometric_audit_events (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL, details jsonb NOT NULL, previous_hash bytea, event_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX biometric_credentials_active_idx ON biometric_credentials(user_id,installation_id,device_id) WHERE state='ACTIVE';
CREATE INDEX biometric_challenges_pending_idx ON biometric_challenges(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX biometric_grants_pending_idx ON biometric_grants(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX biometric_vault_sessions_expiry_idx ON biometric_vault_sessions(expires_at);
ALTER TABLE linqasend_transaction_authorizations_v4 ADD COLUMN biometric_credential_id uuid REFERENCES biometric_credentials(id);
ALTER TABLE linqasend_transaction_authorizations_v4 ADD COLUMN biometric_security_epoch integer;
ALTER TABLE linqasend_transaction_authorizations_v4 ADD COLUMN biometric_session_id uuid REFERENCES auth_sessions(id);
ALTER TABLE linqasend_transaction_authorizations_v4 ADD COLUMN biometric_installation_id uuid REFERENCES device_installations_v2(id);
ALTER TABLE linqasend_transaction_authorizations_v4 ADD COLUMN biometric_payment_challenge_id uuid REFERENCES linqasend_transaction_challenges_v4(id);
ALTER TABLE linqasend_transaction_authorizations_v4 ADD COLUMN biometric_resource_hash bytea;
ALTER TABLE linqasend_transaction_challenges_v4 ADD COLUMN biometric_quote_id uuid REFERENCES linqasend_quotes(id);
ALTER TABLE linqasend_transaction_challenges_v4 ADD COLUMN biometric_payment_method_id uuid REFERENCES linqasend_payment_methods(id);
-- Recovery completion must invalidate credentials in the same transaction as its security event.
CREATE FUNCTION biometric_recovery_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'ACCOUNT_RECOVERY_COMPLETED' THEN
    INSERT INTO biometric_security_state(user_id) VALUES(NEW.user_id) ON CONFLICT DO NOTHING;
    UPDATE biometric_security_state SET security_epoch=security_epoch+1,updated_at=now() WHERE user_id=NEW.user_id;
    UPDATE biometric_credentials SET state='REVOKED',revoked_at=now() WHERE user_id=NEW.user_id AND state='ACTIVE';
    UPDATE biometric_vault_sessions SET revoked_at=now() WHERE user_id=NEW.user_id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER biometric_recovery_invalidate_trigger AFTER INSERT ON linqasend_security_change_events_v4
FOR EACH ROW EXECUTE FUNCTION biometric_recovery_invalidate();
COMMIT;
