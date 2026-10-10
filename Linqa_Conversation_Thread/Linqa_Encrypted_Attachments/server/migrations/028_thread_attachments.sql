-- Encrypted thread attachments. Server stores ciphertext and vault pointers only.

CREATE TABLE IF NOT EXISTS thread_attachments (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_user_id  TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN (
    'VIDEO','VOICE','DOCUMENT','DESIGN','AI_IMAGE','LOCATION','EVENT','MEETING'
  )),
  vault_id        TEXT,
  envelope        BYTEA NOT NULL,
  byte_length     INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS location_shares (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_user_id   TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('REQUESTED','SHARING','STOPPED','DECLINED')),
  requested_by    TEXT NOT NULL,
  expires_at      TIMESTAMPTZ,
  envelope        BYTEA,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thread_attachments_conv_idx
  ON thread_attachments(conversation_id, created_at DESC);
