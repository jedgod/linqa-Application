-- Repo-native admin/staff operations layer.
-- Builds ON TOP of the real support_cases_v2 / support_case_events_v2 tables
-- (server/src/db/migrations/018_ga_hardening.sql) instead of introducing a
-- second case table. See Admin-Staff/Admin-Staff_page/
-- Linqa_Repo_Native_Admin_Staff_Consolidation_Pack.txt for the design intent
-- this migration replaces the never-wired, schema-mismatched Admin-Staff/
-- folder with.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE ops_staff_presence AS ENUM ('AVAILABLE','BUSY','AWAY','OFFLINE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops_staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  staff_role text NOT NULL,
  team_name text,
  presence ops_staff_presence NOT NULL DEFAULT 'OFFLINE',
  active_case_count integer NOT NULL DEFAULT 0 CHECK (active_case_count >= 0),
  max_concurrent_cases integer NOT NULL DEFAULT 8 CHECK (max_concurrent_cases > 0),
  suspended boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- support_cases_v2 (018_ga_hardening.sql) has no notion of a structured
-- assignee yet -- assigned_team/assigned_agent are free-text. This adds a
-- real FK alongside them without touching their existing behavior.
ALTER TABLE support_cases_v2
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES ops_staff_profiles(id);

CREATE INDEX IF NOT EXISTS idx_support_cases_v2_assigned_staff
  ON support_cases_v2(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops_case_assignments_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES ops_staff_profiles(id),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id),
  assignment_type text NOT NULL CHECK (assignment_type IN ('AUTO','MANUAL','REASSIGN','ESCALATION')),
  reason_code text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_case_assignments_v2_active
  ON ops_case_assignments_v2(case_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_ops_outbox_pending
  ON ops_outbox(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  actor_scope_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  reason_code text,
  request_id text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_events_resource
  ON ops_audit_events(resource_type, resource_id, created_at DESC);
