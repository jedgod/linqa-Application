ALTER TABLE onboarding_state DROP CONSTRAINT onboarding_state_last_next_step_check;
ALTER TABLE onboarding_state ADD CONSTRAINT onboarding_state_last_next_step_check
  CHECK (last_next_step IN (
    'AUTH_REQUIRED','DEVICE_ENROLLMENT','PROFILE_SETUP','RECOVERY_SETUP',
    'COUNTRY_CONFIRMATION','COUNTRY_DISCOVERY','SECURITY_REVIEW','COMPLETION','COMPLETE'
  ));
