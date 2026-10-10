-- Voice and video calls. Signaling state only. Media stays on the peer path.

CREATE TABLE IF NOT EXISTS calls (
  id            TEXT PRIMARY KEY,
  caller_id     TEXT NOT NULL,
  peer_user_id  TEXT NOT NULL,
  call_type     TEXT NOT NULL CHECK (call_type IN ('AUDIO','VIDEO')),
  privacy_mode  TEXT NOT NULL CHECK (privacy_mode IN ('STANDARD','RELAY_ONLY')),
  state         TEXT NOT NULL CHECK (state IN ('RINGING','ACCEPTED','ACTIVE','REJECTED','ENDED','FAILED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_peer_idx ON calls(peer_user_id, created_at DESC);
