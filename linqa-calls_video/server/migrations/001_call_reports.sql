-- Call reports. Metadata only: calls are end-to-end encrypted and never recorded.
CREATE TABLE IF NOT EXISTS call_reports (
  id                 UUID PRIMARY KEY,
  call_id            UUID        NOT NULL,
  conversation_id    TEXT        NOT NULL,
  kind               TEXT        NOT NULL CHECK (kind IN ('voice', 'video')),
  reporter_user_id   TEXT        NOT NULL,
  reported_user_ids  TEXT[]      NOT NULL,
  reason             TEXT        NOT NULL CHECK (reason IN
                       ('harassment', 'spam', 'sexual-content', 'violence', 'impersonation', 'other')),
  note               VARCHAR(1000),
  call_created_at    TIMESTAMPTZ NOT NULL,
  call_answered_at   TIMESTAMPTZ,
  call_ended_at      TIMESTAMPTZ,
  participant_user_ids TEXT[]    NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS call_reports_reported_idx ON call_reports USING GIN (reported_user_ids);
CREATE INDEX IF NOT EXISTS call_reports_status_idx   ON call_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS call_reports_dedupe_idx   ON call_reports (call_id, reporter_user_id);
