-- Clearing and deleting a chat, for one person only. Messages stay for everyone else in the conversation.
--   cleared_at  messages sent before this are no longer shown to this person
--   hidden_at   the chat is out of this person's list until a newer message arrives
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
