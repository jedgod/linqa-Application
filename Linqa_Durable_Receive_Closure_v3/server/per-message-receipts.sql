-- Apply only after mapping chat_messages ID and conversation member tables.
-- No message payloads or replacement chat history.
CREATE TABLE IF NOT EXISTS chat_message_reads_v3 (
 account_id text NOT NULL,
 conversation_id text NOT NULL,
 message_id text NOT NULL,
 device_id text NOT NULL,
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id, conversation_id, message_id)
);
CREATE INDEX IF NOT EXISTS chat_message_reads_v3_thread ON chat_message_reads_v3(conversation_id,message_id);
