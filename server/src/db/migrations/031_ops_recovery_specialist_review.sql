-- Recovery specialist evidence review + decision record. Read-only against
-- recovery_email_identities_v3 / trusted_installation_devices_v3 /
-- webauthn_credentials -- this table stores the OPERATIONS WORKFLOW DECISION
-- only (who reviewed, what evidence was visible, decision, rationale), never
-- an auth source of truth. See Admin-Staff/Admin-Staff_page/
-- Linqa_Repo_Native_Recovery_Specialist_Review_Approval_Pack.txt.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE ops_recovery_review_decision AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'ESCALATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops_recovery_reviews_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  reviewer_user_id uuid REFERENCES users(id),
  decision ops_recovery_review_decision NOT NULL DEFAULT 'PENDING',

  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  specialist_note text,
  reason_code text,

  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_recovery_reviews_v1_user
ON ops_recovery_reviews_v1(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_recovery_reviews_v1_decision
ON ops_recovery_reviews_v1(decision, updated_at DESC);
