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
