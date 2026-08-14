BEGIN;

ALTER TABLE authentication_challenges
  ADD COLUMN IF NOT EXISTS phone_country_iso2 TEXT,
  ADD COLUMN IF NOT EXISTS phone_line_type TEXT,
  ADD COLUMN IF NOT EXISTS phone_carrier_name TEXT,
  ADD COLUMN IF NOT EXISTS phone_carrier_country TEXT,
  ADD COLUMN IF NOT EXISTS phone_provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS phone_risk_score INTEGER,
  ADD COLUMN IF NOT EXISTS phone_risk_decision TEXT,
  ADD COLUMN IF NOT EXISTS phone_risk_reasons TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS onboarding_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  registration_required BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_required BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_ready BOOLEAN NOT NULL DEFAULT FALSE,
  country_initialized BOOLEAN NOT NULL DEFAULT FALSE,
  country_verification_state TEXT NOT NULL DEFAULT 'UNVERIFIED',
  discovery_configured BOOLEAN NOT NULL DEFAULT FALSE,
  last_next_step TEXT NOT NULL DEFAULT 'AUTH_REQUIRED',
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (last_next_step IN (
    'AUTH_REQUIRED','DEVICE_ENROLLMENT','RECOVERY_SETUP','COUNTRY_CONFIRMATION',
    'COUNTRY_DISCOVERY','SECURITY_REVIEW','COMPLETE'
  ))
);

CREATE INDEX IF NOT EXISTS onboarding_state_next_step_idx
  ON onboarding_state(last_next_step) WHERE completed_at IS NULL;

-- Existing accounts are not forced back through recovery. Their verified
-- server data still determines every other state on first status resolution.
INSERT INTO onboarding_state(user_id, registration_required, recovery_required)
SELECT id, FALSE, FALSE FROM users
ON CONFLICT(user_id) DO NOTHING;

COMMIT;
