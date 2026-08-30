-- Fraud & risk specialist evidence review + decision record. Read-only
-- against safety_reports / linqasend_payment_methods / linqasend_transfers /
-- linqasend_risk_assessments / users.status -- this table stores the
-- OPERATIONS WORKFLOW DECISION only (who reviewed, what evidence was
-- visible, decision, rationale). APPROVED here does not release a hold,
-- reverse a transfer, suspend a user or change Trust & Safety enforcement;
-- none of those tables are ever written by this workflow. See
-- Admin-Staff/Admin-Staff_page/Linqa_Repo_Native_Fraud_Risk_Specialist_Review_Pack.txt.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE ops_fraud_risk_review_decision AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'ESCALATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops_fraud_risk_reviews_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  reviewer_user_id uuid REFERENCES users(id),
  decision ops_fraud_risk_review_decision NOT NULL DEFAULT 'PENDING',

  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  specialist_note text,
  reason_code text,

  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_fraud_risk_reviews_v1_user
ON ops_fraud_risk_reviews_v1(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_fraud_risk_reviews_v1_decision
ON ops_fraud_risk_reviews_v1(decision, updated_at DESC);
