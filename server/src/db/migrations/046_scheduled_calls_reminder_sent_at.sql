-- Forward migration for a change that was wrongly made inside 042 after 042 had
-- already been applied (commit 5612855). 042 is restored to the content that was
-- applied, so its recorded checksum matches again, and the column lives here.
-- Reminder workers update this atomically after a scheduled call is handled.
ALTER TABLE scheduled_calls
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
