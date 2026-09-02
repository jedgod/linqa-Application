-- Linqa Chat: production backend + realtime (v2.0 pack), adapted to this repo.
--
-- THREE DELIBERATE DEPARTURES FROM THE PACK
--
-- 1. No `tenant_id`. This codebase has no tenancy: there is one Linqa, and the
--    isolation boundary is an active `conversation_members` row. Carrying a
--    tenant column that is always the same value would look like an enforced
--    boundary while enforcing nothing, and every query below would gain a
--    predicate that can never fail. Membership is checked instead, everywhere.
--
-- 2. No parallel identity/conversation tables. The pack defines `app_user`,
--    `conversation` and `conversation_member`; this repo already has `users`,
--    `conversations` and `conversation_members`, and the Chats screen reads
--    them. A second set would be two sources of truth for one domain.
--
-- 3. NO PLAINTEXT MESSAGE BODIES. The pack's `chat_message` offers
--    `body_ciphertext` OR `body_text`. Linqa is end-to-end encrypted: messages
--    travel as device-to-device envelopes (`/v1/relay/envelopes`) and the
--    server holds no key. Adding a plaintext column would create a second,
--    server-readable message path and quietly retire the guarantee the rest of
--    the product is built on -- so `chat_messages` stores ciphertext only, and
--    the inbox derives its preview from the message *kind*.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE chat_message_kind AS ENUM ('TEXT','VOICE','PHOTOS','CALL','SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_delivery_state AS ENUM ('QUEUED','SENT','DELIVERED','READ','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_job_state AS ENUM ('PENDING','LEASED','COMPLETED','DEAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_broadcast_state AS ENUM ('SCHEDULED','PROCESSING','COMPLETED','CANCELLED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Direct-conversation dedupe key
--
-- The pack orders the pair in JavaScript with `[a,b].sort()`. That is a
-- lexicographic sort of the hyphenated *string*, while Postgres compares `uuid`
-- by its 16 bytes -- the two agree only while every id is lowercase canonical
-- hex, and disagree the moment one arrives uppercase ('A' = 65 sorts before
-- 'a' = 97), which trips the CHECK and 500s the request. Ordering is done in
-- SQL with LEAST/GREATEST on the uuid type instead, so there is one comparison
-- rule and it is the database's.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_conversation_keys (
  user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_low < user_high),
  PRIMARY KEY (user_low, user_high)
);

-- ---------------------------------------------------------------------------
-- Messages
--
-- `UNIQUE (conversation_id, sender_user_id, client_message_id)` -- note the
-- conversation. The pack keys idempotency on (tenant, sender, clientMessageId)
-- only, so a client that reuses one id in two conversations gets the *first*
-- conversation's message back, and the caller then points conversation B's
-- `last_message_id` at a row belonging to conversation A -- leaking A's message
-- into B's inbox. Scoping the key to the conversation removes that entirely.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  client_message_id UUID NOT NULL,
  kind chat_message_kind NOT NULL,
  -- Ciphertext only. There is deliberately no plaintext column here.
  body_ciphertext BYTEA,
  media_count INTEGER NOT NULL DEFAULT 0 CHECK (media_count BETWEEN 0 AND 20),
  reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  -- A CALL or SYSTEM marker carries no body; everything else must.
  CHECK (
    (kind IN ('CALL','SYSTEM') AND body_ciphertext IS NULL)
    OR (kind NOT IN ('CALL','SYSTEM') AND body_ciphertext IS NOT NULL)
  ),
  CHECK (octet_length(COALESCE(body_ciphertext, ''::bytea)) <= 65536),
  UNIQUE (conversation_id, sender_user_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS chat_messages_page_idx
  ON chat_messages (conversation_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- A reply must live in the same conversation as its target. Without this a
-- crafted `replyToId` confirms that some message id exists in a conversation
-- the sender cannot read -- a cross-conversation existence oracle.
CREATE OR REPLACE FUNCTION chat_messages_reply_same_conversation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chat_messages parent
    WHERE parent.id = NEW.reply_to_id AND parent.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'reply target is not in this conversation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_reply_guard ON chat_messages;
CREATE TRIGGER chat_messages_reply_guard
  BEFORE INSERT OR UPDATE OF reply_to_id ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_reply_same_conversation();

CREATE TABLE IF NOT EXISTS chat_message_receipts (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state chat_delivery_state NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Read pointer. `conversation_members.unread_count` stays the fast path the
-- inbox already reads; this records *where* the member has read to, which is
-- what lets a second device reconcile without trusting its own counter.
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS last_read_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Transactional outbox
--
-- Durable events are committed with the state change that produced them, then
-- relayed. WebSocket delivery is an optimization on top, never the record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_outbox (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS chat_outbox_pending_idx ON chat_outbox (id) WHERE published_at IS NULL;
-- Replay (`?afterEventId=`) reads forward within one conversation.
CREATE INDEX IF NOT EXISTS chat_outbox_replay_idx ON chat_outbox (conversation_id, id);

CREATE TABLE IF NOT EXISTS chat_delivery_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  state chat_job_state NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  leased_until TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_delivery_due_idx ON chat_delivery_jobs (run_at, id)
  WHERE state IN ('PENDING','LEASED');

-- ---------------------------------------------------------------------------
-- QR contact exchange
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_qr_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of a 256-bit random token. A password KDF buys nothing here: the
  -- input is full-entropy, so there is no guess space to slow down.
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 20),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (use_count <= max_uses)
);
CREATE INDEX IF NOT EXISTS contact_qr_expiry_idx ON contact_qr_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_qr_owner_idx ON contact_qr_tokens (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_contacts (
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_via TEXT NOT NULL CHECK (created_via IN ('QR','SEARCH','INVITE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_user_id <> contact_user_id),
  PRIMARY KEY (owner_user_id, contact_user_id)
);

-- ---------------------------------------------------------------------------
-- Broadcasts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Ciphertext, for the same reason chat_messages has no plaintext column.
  body_ciphertext BYTEA NOT NULL,
  CHECK (octet_length(body_ciphertext) BETWEEN 1 AND 65536),
  scheduled_at TIMESTAMPTZ,
  state chat_broadcast_state NOT NULL DEFAULT 'PROCESSING',
  client_request_id UUID NOT NULL,
  -- Binds the idempotency key to the payload it was issued for. A retry that
  -- reuses the key with a *different* body is a different intent and must be
  -- rejected, not silently answered with the original campaign.
  request_fingerprint BYTEA NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (created_by, client_request_id)
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  campaign_id UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state chat_delivery_state NOT NULL DEFAULT 'QUEUED',
  message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_pending_idx
  ON broadcast_recipients (campaign_id) WHERE state = 'QUEUED';

-- ---------------------------------------------------------------------------
-- Security audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_security_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT NOT NULL,
  ip_hash BYTEA,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_security_audit_actor_idx
  ON chat_security_audit (actor_user_id, created_at DESC);
