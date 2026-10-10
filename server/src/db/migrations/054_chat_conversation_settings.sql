-- Per-conversation settings: disappearing messages.
--
-- A conversation can ask for its messages to disappear after a day, a week or four weeks. The setting applies to messages
-- sent after it is turned on: each new message is stamped with its own expiry when it is stored, so changing the setting
-- never rewrites or shortens messages that already exist. Expired messages are never returned and are deleted the next
-- time someone sends in the conversation.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS disappear_after_seconds INTEGER
  CHECK (disappear_after_seconds IS NULL OR disappear_after_seconds IN (86400, 604800, 2419200));

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chat_messages_expiry ON chat_messages (expires_at) WHERE expires_at IS NOT NULL;
