BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS vault_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('CONSUMER','BUSINESS')),
  name text NOT NULL,
  plan_code text NOT NULL DEFAULT 'FREE_5GB',
  quota_bytes bigint NOT NULL DEFAULT 5368709120 CHECK(quota_bytes >= 0),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_workspaces_owner_idx ON vault_workspaces(owner_user_id);
CREATE TABLE IF NOT EXISTS vault_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES vault_folders(id) ON DELETE CASCADE, name text NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,parent_id,name)
);
CREATE TABLE IF NOT EXISTS vault_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES vault_folders(id) ON DELETE SET NULL, owner_user_id uuid NOT NULL,
  display_name text NOT NULL, media_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
  sha256 text, blob_key text UNIQUE, classification text NOT NULL DEFAULT 'NORMAL',
  state text NOT NULL CHECK(state IN ('PENDING','QUARANTINED','AVAILABLE','BLOCKED','DELETED')),
  source_kind text NOT NULL DEFAULT 'DEVICE', source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS vault_objects_workspace_state_idx ON vault_objects(workspace_id,state,created_at DESC);
CREATE TABLE IF NOT EXISTS vault_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, filename text NOT NULL, media_type text NOT NULL, expected_bytes bigint NOT NULL CHECK(expected_bytes > 0),
  reserved_bytes bigint NOT NULL CHECK(reserved_bytes > 0), blob_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'CREATED' CHECK(state IN ('CREATED','UPLOADING','UPLOADED','ABORTED','COMPLETED')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_idempotency (
  workspace_id uuid NOT NULL, scope text NOT NULL, idempotency_key text NOT NULL, response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,scope,idempotency_key)
);
COMMIT;
