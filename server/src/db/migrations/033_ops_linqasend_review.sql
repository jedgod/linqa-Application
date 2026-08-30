-- LinqaSend transaction investigation + specialist review decision record.
-- Read-only against linqasend_payment_methods / linqasend_transfers /
-- linqasend_recipients -- this table stores the OPERATIONS WORKFLOW DECISION
-- only. APPROVED here does not release a hold, reverse or cancel a transfer,
-- issue a refund, or mutate a payment method; none of those tables are ever
-- written by this workflow. See Admin-Staff/Admin-Staff_page/
-- Linqa_Repo_Native_LinqaSend_Transaction_Investigation_Specialist_Review_Pack.txt.
--
-- Indexes mirror 031/032 rather than the pack, which shipped none.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE ops_linqasend_review_decision AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'ESCALATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops_linqasend_reviews_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  reviewer_user_id uuid REFERENCES users(id),
  decision ops_linqasend_review_decision NOT NULL DEFAULT 'PENDING',

  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  specialist_note text,
  reason_code text,

  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_linqasend_reviews_v1_user
ON ops_linqasend_reviews_v1(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_linqasend_reviews_v1_decision
ON ops_linqasend_reviews_v1(decision, updated_at DESC);
