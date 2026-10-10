-- Contact details are sealed by the sender; the relay stores only the envelope.
ALTER TABLE thread_attachments DROP CONSTRAINT IF EXISTS thread_attachments_kind_check;
ALTER TABLE thread_attachments ADD CONSTRAINT thread_attachments_kind_check
  CHECK (kind IN ('VIDEO','VOICE','DOCUMENT','DESIGN','AI_IMAGE','LOCATION','CONTACT','EVENT','MEETING'));
