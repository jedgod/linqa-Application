-- Durable customer-facing support messages, separate from the internal-only
-- support_case_events_v2 log and ops_case_internal_notes_v2. See
-- Admin-Staff/Admin-Staff_page/Linqa_Repo_Native_Customer_Reply_Support_Message_History_Pack.txt
-- for the design intent this migration implements (adapted to the real
-- support_cases_v2.user_id column -- the pack assumed client_user_id).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE ops_support_message_direction AS ENUM ('CLIENT_TO_STAFF','STAFF_TO_CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ops_support_delivery_status AS ENUM ('PENDING','SENT','DELIVERED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops_case_customer_messages_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES users(id),
  direction ops_support_message_direction NOT NULL,
  author_user_id uuid REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  delivery_status ops_support_delivery_status NOT NULL DEFAULT 'PENDING',
  transport_message_id text,
  delivery_error_code text,
  delivery_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ops_case_customer_messages_v2_case_created
ON ops_case_customer_messages_v2(case_id, created_at ASC);
