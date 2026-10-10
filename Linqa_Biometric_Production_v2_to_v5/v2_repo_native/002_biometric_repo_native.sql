BEGIN;
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS installation_id uuid;
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE biometric_credentials ADD COLUMN IF NOT EXISTS security_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE biometric_credentials ADD CONSTRAINT biometric_credentials_state_ck CHECK (state IN ('PENDING','ACTIVE','SUSPENDED','REVOKED'));
ALTER TABLE biometric_challenges ADD COLUMN IF NOT EXISTS installation_id uuid;
ALTER TABLE biometric_grants ADD COLUMN IF NOT EXISTS installation_id uuid;
CREATE INDEX IF NOT EXISTS biometric_credentials_installation_idx ON biometric_credentials(user_id,installation_id,device_id) WHERE revoked_at IS NULL;
COMMIT;
