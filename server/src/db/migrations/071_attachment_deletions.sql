ALTER TABLE thread_attachments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE thread_attachments DROP CONSTRAINT IF EXISTS thread_attachments_envelope_check;
ALTER TABLE thread_attachments ADD CONSTRAINT thread_attachments_envelope_check
  CHECK (deleted_at IS NOT NULL OR octet_length(envelope) BETWEEN 32 AND 262144);
CREATE TABLE IF NOT EXISTS chat_attachment_deletions (
  attachment_id UUID NOT NULL REFERENCES thread_attachments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attachment_id,user_id)
);
