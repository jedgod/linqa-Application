BEGIN;
-- Separate names avoid overwriting existing Linqa chat tables. Bind user UUIDs
-- to your canonical account table after checking the actual live schema.
CREATE TABLE IF NOT EXISTS lc2_conversations (
 id uuid PRIMARY KEY, pair_key text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc2_members (
 conversation_id uuid REFERENCES lc2_conversations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS lc2_events (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id uuid UNIQUE NOT NULL, conversation_id uuid NOT NULL REFERENCES lc2_conversations(id),
 sender_id uuid NOT NULL, client_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_id,client_id),
 FOREIGN KEY(conversation_id,sender_id) REFERENCES lc2_members(conversation_id,user_id)
);
-- One ciphertext envelope per authorized device, including sender's devices.
-- User/device keys are opaque canonical IDs from the device directory adapter.
CREATE TABLE IF NOT EXISTS lc2_envelopes (
 event_id uuid REFERENCES lc2_events(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, device_id text NOT NULL, ciphertext text NOT NULL,
 PRIMARY KEY(event_id,user_id,device_id)
);
CREATE INDEX IF NOT EXISTS lc2_events_history ON lc2_events(conversation_id,seq);
CREATE INDEX IF NOT EXISTS lc2_envelopes_recipient ON lc2_envelopes(user_id,device_id,event_id);
COMMIT;
