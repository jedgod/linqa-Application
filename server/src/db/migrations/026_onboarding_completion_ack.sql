BEGIN;

ALTER TABLE onboarding_state
  ADD COLUMN IF NOT EXISTS completion_screen_seen_at TIMESTAMPTZ;

ALTER TABLE onboarding_state DROP CONSTRAINT IF EXISTS onboarding_state_last_next_step_check;
ALTER TABLE onboarding_state ADD CONSTRAINT onboarding_state_last_next_step_check CHECK (last_next_step IN (
  'AUTH_REQUIRED','DEVICE_ENROLLMENT','RECOVERY_SETUP','COUNTRY_CONFIRMATION',
  'COUNTRY_DISCOVERY','SECURITY_REVIEW','COMPLETION','COMPLETE'
));

-- Do not send existing users or accounts that completed before this feature
-- back through a new-account celebration on their next cold launch.
UPDATE onboarding_state
SET completion_screen_seen_at = COALESCE(completed_at, now())
WHERE completion_screen_seen_at IS NULL
  AND (registration_required = FALSE OR completed_at IS NOT NULL);

COMMIT;
