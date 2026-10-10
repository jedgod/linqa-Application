-- Vault gap closure: v6.0 (tags, private sessions, secure links, transfers, billing, login alerts)
-- reconciled with v7.0 (provider certification, entitlements, security events, worker heartbeats).
--
-- Reconciliation with what is already live (047 and the existing encrypted vault_items store):
--  * v6 and v7 both define vault_billing_events with different columns. v7's is used (it records
--    whether the signature verified and the processing state).
--  * v7's vault_quarantine_objects and vault_handoff_grants duplicate the intake workflow already
--    shipped to the mobile app (vault_intake_requests). Quarantine stays in vault_intake_requests;
--    handoff grants are keyed to the intake request instead.
--  * v7's vault_share_records duplicates v6's vault_secure_links / vault_share_transfers; v6's are used.
--  * The packs key accounts by text ids; this platform keys everything by users.id (uuid).
--  * The v6 code writes values the 047 CHECK constraints reject (intake kind SCAN_DOCUMENT, state
--    COMPLETED, role VIEWER, export destination SOCIAL); the constraints are widened here.
--  * Objects imported from outside are client-encrypted: their name lives in encrypted_metadata,
--    so display_name becomes optional.

-- Widen constraints the pack's code needs.
ALTER TABLE vault_workspace_members DROP CONSTRAINT IF EXISTS vault_workspace_members_role_check;
ALTER TABLE vault_workspace_members ADD CONSTRAINT vault_workspace_members_role_check CHECK (role IN ('OWNER','ADMIN','MEMBER','AUDITOR','VIEWER'));

ALTER TABLE vault_intake_requests DROP CONSTRAINT IF EXISTS vault_intake_requests_source_kind_check;
ALTER TABLE vault_intake_requests ADD CONSTRAINT vault_intake_requests_source_kind_check CHECK (source_kind IN ('SOCIAL','MESSAGE','CLIENT','EXTERNAL_LINK','DEVICE','SCAN','SCAN_DOCUMENT'));
ALTER TABLE vault_intake_requests DROP CONSTRAINT IF EXISTS vault_intake_requests_state_check;
ALTER TABLE vault_intake_requests ADD CONSTRAINT vault_intake_requests_state_check CHECK (state IN ('RECEIVED','FETCHING','QUARANTINED','SCANNING','AWAITING_CONFIRMATION','HANDOFF_READY','COMPLETED','VAULTED','BLOCKED','FAILED','PURGED'));

ALTER TABLE vault_export_grants DROP CONSTRAINT IF EXISTS vault_export_grants_destination_kind_check;
ALTER TABLE vault_export_grants ADD CONSTRAINT vault_export_grants_destination_kind_check CHECK (destination_kind IN ('LINQA_MESSAGE','LINQA_GROUP','LINQA_SOCIAL_POST','SECURE_LINK','EMAIL','SOCIAL'));

ALTER TABLE vault_objects ALTER COLUMN display_name DROP NOT NULL;
ALTER TABLE vault_objects ALTER COLUMN media_type SET DEFAULT 'application/octet-stream';
ALTER TABLE vault_objects ADD COLUMN IF NOT EXISTS encrypted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vault_objects ADD COLUMN IF NOT EXISTS source_intake_id uuid;
ALTER TABLE vault_objects ADD COLUMN IF NOT EXISTS content_encryption text NOT NULL DEFAULT 'CLIENT_E2EE';
ALTER TABLE vault_objects ADD COLUMN IF NOT EXISTS current_version_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS vault_objects_source_intake_idx ON vault_objects(source_intake_id) WHERE source_intake_id IS NOT NULL;

-- A clean quarantined file is handed to the device once, with a short-lived grant bound to that device.
CREATE TABLE IF NOT EXISTS vault_handoff_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES vault_intake_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE TABLE IF NOT EXISTS vault_object_tags (
  object_id uuid NOT NULL REFERENCES vault_objects(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES vault_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (object_id, tag_id)
);

CREATE TABLE IF NOT EXISTS vault_private_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  stepup_jti text,
  security_epoch bigint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_private_sessions_user_idx ON vault_private_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS vault_secure_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES vault_objects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  max_downloads integer CHECK (max_downloads IS NULL OR max_downloads > 0),
  download_count integer NOT NULL DEFAULT 0,
  require_auth boolean NOT NULL DEFAULT true,
  recipient_email text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_share_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id),
  object_id uuid NOT NULL REFERENCES vault_objects(id),
  sender_user_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  destination_workspace_id uuid,
  kind text NOT NULL CHECK (kind IN ('LINQA_USER','VAULT_TO_VAULT')),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ACCEPTED','REJECTED','REVOKED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acted_at timestamptz
);

CREATE TABLE IF NOT EXISTS vault_email_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secure_link_id uuid NOT NULL REFERENCES vault_secure_links(id),
  recipient_email text NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED',
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS vault_billing_customers (
  user_id uuid PRIMARY KEY,
  provider_customer_ref text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_billing_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES vault_workspaces(id),
  plan_code text NOT NULL,
  provider text NOT NULL,
  provider_session_ref text UNIQUE,
  state text NOT NULL DEFAULT 'CREATED',
  idempotency_key text NOT NULL UNIQUE,
  checkout_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS vault_billing_events (
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  raw_sha256 text NOT NULL,
  verified boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('RECEIVED','PROCESSED','QUARANTINED','FAILED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS vault_entitlements (
  user_id uuid PRIMARY KEY,
  plan_code text NOT NULL,
  status text NOT NULL,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_login_alert_preferences (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_intake_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES vault_intake_requests(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  plaintext_inspection_consent boolean NOT NULL DEFAULT false,
  client_scan_attestation jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_provider_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_kind text NOT NULL,
  provider_name text NOT NULL,
  environment text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REVOKED','EXPIRED')),
  git_sha text NOT NULL,
  artifact_digest text NOT NULL,
  evidence_digest text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz,
  UNIQUE (provider_kind, provider_name, environment, git_sha, artifact_digest)
);

CREATE TABLE IF NOT EXISTS vault_security_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id text,
  kind text NOT NULL,
  severity text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_worker_heartbeats (
  worker text PRIMARY KEY,
  git_sha text NOT NULL,
  artifact_digest text NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
