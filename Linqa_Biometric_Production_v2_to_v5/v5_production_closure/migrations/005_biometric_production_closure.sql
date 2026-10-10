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
