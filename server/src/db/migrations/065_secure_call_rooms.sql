-- Opaque key envelopes and call membership only; never SDP, call keys or media.
CREATE TABLE IF NOT EXISTS secure_call_rooms (
  call_id UUID PRIMARY KEY REFERENCES call_sessions(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secure_call_reports (
  id UUID PRIMARY KEY,
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secure_call_report_subjects (
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  reported_user_id UUID NOT NULL REFERENCES users(id),
  report_id UUID NOT NULL REFERENCES secure_call_reports(id) ON DELETE CASCADE,
  PRIMARY KEY (call_id, reporter_user_id, reported_user_id)
);
