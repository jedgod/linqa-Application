-- New opaque attachment records only; no new chat history.
-- Parent identifiers are canonical strings. Existing membership queries retain
-- their repository-native types; map them through authorize(), not SQL casts.
CREATE TABLE IF NOT EXISTS chat_media_uploads_v1 (
 upload_id uuid PRIMARY KEY,
 account_id text NOT NULL, device_id text NOT NULL, chat_id text NOT NULL,
 digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 byte_length bigint NOT NULL CHECK(byte_length BETWEEN 28 AND 27262976),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_media_uploads_v1_scope ON chat_media_uploads_v1(chat_id,created_at);
