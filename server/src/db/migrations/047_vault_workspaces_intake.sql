-- Vault workspaces, secure intake, plans, step-up/export grants, audit chain and outbox.
-- From Vault-Interface/Linqa_Vault_Backend_Wired_v1_to_v5 (v1.0 to v5.0), schema only; the
-- routes wired today are folders and Save from Social (see src/routes/vault-intake.ts).
-- Differences from the pack: one consumer workspace per owner is enforced by an index (the pack's
-- "ON CONFLICT DO NOTHING" had nothing to conflict with), and intake rows carry the fetched
-- file's size, media type, hash and quarantine key so quota and confirmation can be exact.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vault_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CONSUMER','BUSINESS')),
  name text NOT NULL,
  plan_code text NOT NULL DEFAULT 'FREE_5GB',
  quota_bytes bigint NOT NULL DEFAULT 5368709120 CHECK (quota_bytes >= 0),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_workspaces_owner_idx ON vault_workspaces(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS vault_workspaces_one_consumer_idx ON vault_workspaces(owner_user_id) WHERE kind = 'CONSUMER';

CREATE TABLE IF NOT EXISTS vault_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES vault_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- NULL parents compare as distinct in a plain UNIQUE, so root-level names get their own index.
CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_child_name_idx ON vault_folders(workspace_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_root_name_idx ON vault_folders(workspace_id, lower(name)) WHERE parent_id IS NULL;

CREATE TABLE IF NOT EXISTS vault_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES vault_folders(id) ON DELETE SET NULL,
  owner_user_id uuid NOT NULL,
  display_name text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text,
  blob_key text UNIQUE,
  classification text NOT NULL DEFAULT 'NORMAL',
  state text NOT NULL CHECK (state IN ('PENDING','QUARANTINED','AVAILABLE','BLOCKED','DELETED')),
  source_kind text NOT NULL DEFAULT 'DEVICE',
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS vault_objects_workspace_state_idx ON vault_objects(workspace_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  filename text NOT NULL,
  media_type text NOT NULL,
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0),
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes > 0),
  blob_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'CREATED' CHECK (state IN ('CREATED','UPLOADING','UPLOADED','ABORTED','COMPLETED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_idempotency (
  workspace_id uuid NOT NULL,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS vault_intake_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id),
  requested_by uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('SOCIAL','MESSAGE','CLIENT','EXTERNAL_LINK','DEVICE','SCAN')),
  source_ref text NOT NULL,
  destination_folder_id uuid REFERENCES vault_folders(id),
  display_name text NOT NULL,
  media_type text,
  size_bytes bigint,
  sha256 text,
  quarantine_key text,
  state text NOT NULL DEFAULT 'RECEIVED' CHECK (state IN ('RECEIVED','FETCHING','QUARANTINED','SCANNING','AWAITING_CONFIRMATION','VAULTED','BLOCKED','FAILED')),
  upload_id uuid REFERENCES vault_upload_sessions(id),
  object_id uuid REFERENCES vault_objects(id),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_kind, source_ref)
);

CREATE TABLE IF NOT EXISTS vault_scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES vault_intake_requests(id) ON DELETE CASCADE,
  engine text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('CLEAN','MALWARE','SUSPICIOUS','ERROR')),
  dlp_verdict text NOT NULL DEFAULT 'CLEAR' CHECK (dlp_verdict IN ('CLEAR','REVIEW','BLOCK')),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_workspace_members (
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER','AUDITOR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVITED','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS vault_plans (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('CONSUMER','BUSINESS')),
  quota_bytes bigint NOT NULL,
  monthly_price_minor integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  features jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true
);
INSERT INTO vault_plans (code, kind, quota_bytes, monthly_price_minor) VALUES
  ('FREE_5GB','CONSUMER',5368709120,0),
  ('C25','CONSUMER',26843545600,199),
  ('C40','CONSUMER',42949672960,299),
  ('C60','CONSUMER',64424509440,399),
  ('C1TB','CONSUMER',1099511627776,1499)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS vault_policy_profiles (
  workspace_id uuid PRIMARY KEY REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  export_social text NOT NULL DEFAULT 'ALLOW_STEP_UP' CHECK (export_social IN ('ALLOW','ALLOW_STEP_UP','DENY')),
  external_links text NOT NULL DEFAULT 'ALLOW_STEP_UP' CHECK (external_links IN ('ALLOW','ALLOW_STEP_UP','DENY')),
  retention_days integer,
  dlp_mode text NOT NULL DEFAULT 'STANDARD' CHECK (dlp_mode IN ('STANDARD','STRICT')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_stepup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id),
  user_id uuid NOT NULL,
  method text NOT NULL,
  assurance_level integer NOT NULL CHECK (assurance_level BETWEEN 1 AND 3),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_export_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id),
  object_id uuid NOT NULL REFERENCES vault_objects(id),
  requested_by uuid NOT NULL,
  destination_kind text NOT NULL CHECK (destination_kind IN ('LINQA_MESSAGE','LINQA_GROUP','LINQA_SOCIAL_POST','SECURE_LINK','EMAIL')),
  destination_ref text,
  scope text NOT NULL DEFAULT 'COPY',
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','AUTHORIZED','EXECUTED','REVOKED','EXPIRED','DENIED')),
  expires_at timestamptz NOT NULL,
  stepup_session_id uuid REFERENCES vault_stepup_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE TABLE IF NOT EXISTS vault_audit_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}',
  prev_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, event_id)
);

CREATE TABLE IF NOT EXISTS vault_outbox (
  id bigserial PRIMARY KEY,
  workspace_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL,
  state text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','LEASED','DONE','DEAD')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type, dedupe_key)
);
CREATE INDEX IF NOT EXISTS vault_outbox_ready_idx ON vault_outbox(state, available_at) WHERE state IN ('READY','LEASED');

CREATE TABLE IF NOT EXISTS vault_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS vault_release_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  git_sha text NOT NULL,
  artifact_digest text NOT NULL,
  test_suite text NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS','FAIL')),
  environment text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
