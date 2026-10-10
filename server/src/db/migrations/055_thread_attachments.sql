-- Encrypted thread attachments (Linqa Encrypted Attachments pack, adapted).
--
-- The server stores a sealed envelope and, for media, a pointer to the vault object. It never holds plaintext:
-- an event, a meeting, a voice note or a shared place is opaque bytes here. An attachment follows the conversation's
-- disappearing-messages setting like a message does: it is stamped with its own expiry when stored, never returned
-- once expired, and deleted the next time someone adds to the conversation.
CREATE TABLE IF NOT EXISTS thread_attachments (
  id               UUID PRIMARY KEY,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('VIDEO','VOICE','DOCUMENT','DESIGN','AI_IMAGE','LOCATION','EVENT','MEETING')),
  vault_id         TEXT CHECK (vault_id IS NULL OR length(vault_id) BETWEEN 1 AND 200),
  envelope         BYTEA NOT NULL CHECK (octet_length(envelope) BETWEEN 32 AND 262144),
  byte_length      INTEGER NOT NULL CHECK (byte_length BETWEEN 32 AND 262144),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS thread_attachments_conv_idx ON thread_attachments (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS thread_attachments_expiry ON thread_attachments (expires_at) WHERE expires_at IS NOT NULL;

-- A request for someone's location, and their answer. Coordinates exist only inside the sealed envelope, only after
-- the owner accepts, and the envelope is erased when sharing stops or runs out.
CREATE TABLE IF NOT EXISTS location_shares (
  id              UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state           TEXT NOT NULL CHECK (state IN ('REQUESTED','SHARING','STOPPED','DECLINED')),
  expires_at      TIMESTAMPTZ,
  envelope        BYTEA CHECK (envelope IS NULL OR octet_length(envelope) BETWEEN 32 AND 65536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_user_id <> requested_by),
  CHECK (state <> 'SHARING' OR (envelope IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK (state NOT IN ('STOPPED','DECLINED') OR envelope IS NULL)
);
CREATE INDEX IF NOT EXISTS location_shares_conv_idx ON location_shares (conversation_id, created_at DESC);
