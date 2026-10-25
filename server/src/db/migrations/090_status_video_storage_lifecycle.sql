BEGIN;

-- 1. The multipart session belongs to the server-created attachment record. Until now the client supplied the upload id on every
--    part-signing and completion request, so a client could have pointed a part or the completion at a different session. The server
--    now stores the id it was given by object storage and compares on every call.
--    Uploads created before this migration have no stored id and can no longer be signed or completed (they expire; none are real).
ALTER TABLE attachment_uploads ADD COLUMN IF NOT EXISTS multipart_upload_id TEXT;

-- 2. Say what an upload is FOR. Cleanup must only ever touch uploads made for status videos, never a chat attachment or evidence
--    upload that happens to be a completed video.
ALTER TABLE attachment_uploads ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'GENERAL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachment_uploads_purpose_check') THEN
    ALTER TABLE attachment_uploads ADD CONSTRAINT attachment_uploads_purpose_check CHECK (purpose IN ('GENERAL', 'STATUS_VIDEO'));
  END IF;
END $$;

-- 3. Durable storage cleanup. A row is a promise to remove stored bytes, kept until the storage provider confirms. The row carries
--    everything needed (object key, multipart id) so it still works after the attachment row is gone (account deletion).
CREATE TABLE IF NOT EXISTS status_video_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES attachment_uploads(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('DELETE_OBJECT', 'ABORT_MULTIPART')),
  object_key TEXT NOT NULL,
  multipart_upload_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LEASED', 'DONE', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (action <> 'ABORT_MULTIPART' OR multipart_upload_id IS NOT NULL)
);

-- One live job per object and action, so scanning twice cannot queue the same deletion twice.
CREATE UNIQUE INDEX IF NOT EXISTS status_video_cleanup_jobs_object_action_uq
  ON status_video_cleanup_jobs (object_key, action) WHERE status IN ('PENDING', 'LEASED', 'FAILED');

CREATE INDEX IF NOT EXISTS status_video_cleanup_jobs_due_idx
  ON status_video_cleanup_jobs (next_attempt_at) WHERE status IN ('PENDING', 'FAILED', 'LEASED');

COMMIT;
