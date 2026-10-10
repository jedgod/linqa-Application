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
