ALTER TABLE safety_reports
  ADD COLUMN IF NOT EXISTS evidence_attachment_id UUID REFERENCES attachment_uploads(id);
