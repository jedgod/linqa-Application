-- How a person organizes their own chats: favorites (the existing `pinned` flag), an archive, and custom lists.
-- All of it is per person. Archiving or listing a chat never changes it for anyone else in the conversation.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS conversation_members_archived_idx ON conversation_members (user_id) WHERE archived_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL DEFAULT 'violet' CHECK (color IN ('violet','blue','green','orange','red','teal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_lists_user_name_idx ON chat_lists (user_id, lower(name));

CREATE TABLE IF NOT EXISTS chat_list_items (
  list_id UUID NOT NULL REFERENCES chat_lists(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS chat_list_items_conversation_idx ON chat_list_items (conversation_id);
