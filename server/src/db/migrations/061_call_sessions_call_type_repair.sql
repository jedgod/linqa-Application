-- Repair: call_sessions.call_type was added by 021_lifecycle_completion.sql, but a database that recorded 021 as applied can still
-- lack the column, and placing a call then fails with: column "call_type" of relation "call_sessions" does not exist.
-- Adding it again is idempotent; rows that predate it are plain audio calls.
ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS call_type TEXT NOT NULL DEFAULT 'AUDIO';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'call_sessions'::regclass AND conname = 'call_sessions_call_type_check'
  ) THEN
    ALTER TABLE call_sessions
      ADD CONSTRAINT call_sessions_call_type_check CHECK (call_type IN ('AUDIO','VIDEO','SCREEN_SHARE'));
  END IF;
END $$;
