-- Live screen share. Signaling only. Frames stay on the peer connection.

CREATE TABLE IF NOT EXISTS live_screen_sessions (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  host_user_id     TEXT NOT NULL,
  host_device_id   TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('OFFERED','ACTIVE','STOPPED','DECLINED')),
  offer_envelope   BYTEA,
  answer_envelope  BYTEA,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS live_screen_conv_idx
  ON live_screen_sessions(conversation_id, created_at DESC);
