-- Live screen share (Linqa Capture Access + Live Screen pack, adapted). Signaling only.
--
-- The server relays two sealed envelopes (the host's offer and the viewer's answer) so the two phones can set up a direct
-- connection. Frames never touch the server. An offer that is not answered within five minutes lapses, a share that runs
-- more than four hours is closed, and both envelopes are erased as soon as a session ends or is declined.
CREATE TABLE IF NOT EXISTS live_screen_sessions (
  id              UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  host_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_device_id  UUID REFERENCES devices(id) ON DELETE SET NULL,
  state           TEXT NOT NULL CHECK (state IN ('OFFERED','ACTIVE','STOPPED','DECLINED')),
  offer_envelope  BYTEA CHECK (offer_envelope IS NULL OR octet_length(offer_envelope) BETWEEN 32 AND 65536),
  answer_envelope BYTEA CHECK (answer_envelope IS NULL OR octet_length(answer_envelope) BETWEEN 32 AND 65536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at     TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  CHECK (state NOT IN ('OFFERED','ACTIVE') OR offer_envelope IS NOT NULL),
  CHECK (state <> 'ACTIVE' OR answer_envelope IS NOT NULL),
  CHECK (state NOT IN ('STOPPED','DECLINED') OR (offer_envelope IS NULL AND answer_envelope IS NULL))
);
CREATE INDEX IF NOT EXISTS live_screen_conv_idx ON live_screen_sessions (conversation_id, created_at DESC);
-- At most one open share per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS live_screen_one_open ON live_screen_sessions (conversation_id) WHERE state IN ('OFFERED','ACTIVE');
