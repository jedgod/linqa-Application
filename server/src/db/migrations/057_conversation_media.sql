-- Only encrypted media envelopes are stored; names, MIME types and durations remain inside messages.
CREATE TABLE IF NOT EXISTS conversation_media (
 id UUID PRIMARY KEY,
 conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 envelope BYTEA NOT NULL CHECK (octet_length(envelope) BETWEEN 32 AND 8388608),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS conversation_media_expiry ON conversation_media(expires_at) WHERE expires_at IS NOT NULL;
