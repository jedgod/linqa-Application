BEGIN;

-- v1-v3 production-software closure.  These tables record evidence and
-- orchestration state only; they do not assert that a provider, licence,
-- bank account, or corridor has been externally certified.
CREATE TABLE IF NOT EXISTS linqasend_fraud_signal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id),
  authorization_id UUID,
  user_id UUID NOT NULL,
  device_id UUID,
  signals JSONB NOT NULL,
  source_timestamps JSONB NOT NULL,
  snapshot_hash CHAR(64) NOT NULL UNIQUE,
  complete BOOLEAN NOT NULL,
  stale BOOLEAN NOT NULL,
  missing_signals TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linqasend_country_risk_signals (
  country CHAR(2) PRIMARY KEY,
  risk_score INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  source_reference TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by UUID NOT NULL,
  CHECK (expires_at > observed_at)
);

CREATE TABLE IF NOT EXISTS linqasend_transfer_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL UNIQUE REFERENCES linqasend_transfers(id),
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','LEASED','RUNNING','WAITING','SUCCEEDED','FAILED','DEAD_LETTER')),
  execution_context JSONB NOT NULL DEFAULT '{}',
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 12 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_linqasend_execution_claim ON linqasend_transfer_executions(state,available_at) WHERE state IN ('QUEUED','WAITING');

CREATE TABLE IF NOT EXISTS linqasend_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES linqasend_transfer_executions(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED','SUCCEEDED','FAILED','UNKNOWN')),
  provider_operation_id UUID,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(execution_id,step_name,attempt_number)
);

CREATE TABLE IF NOT EXISTS linqasend_provider_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id),
  provider_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state TEXT NOT NULL DEFAULT 'REGISTERED' CHECK (state IN ('REGISTERED','SUBMITTED','SUCCEEDED','FAILED','UNKNOWN')),
  provider_reference TEXT,
  response_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id,operation_type,idempotency_key)
);

CREATE TABLE IF NOT EXISTS linqasend_provider_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  provider_id TEXT NOT NULL,
  secret_kind TEXT NOT NULL,
  encrypted_data_key BYTEA NOT NULL,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  masked_display TEXT,
  key_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_provider_secret_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id UUID NOT NULL REFERENCES linqasend_provider_secrets(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE linqasend_payment_methods ADD COLUMN IF NOT EXISTS provider_secret_id UUID REFERENCES linqasend_provider_secrets(id);
ALTER TABLE linqasend_payout_endpoints_v1 ADD COLUMN IF NOT EXISTS provider_secret_id UUID REFERENCES linqasend_provider_secrets(id);

CREATE TABLE IF NOT EXISTS linqasend_webhook_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  key_version TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('HMAC_SHA256','ED25519')),
  encrypted_secret BYTEA,
  public_key_pem TEXT,
  active_from TIMESTAMPTZ NOT NULL,
  active_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id,key_version),
  CHECK ((algorithm='HMAC_SHA256' AND encrypted_secret IS NOT NULL) OR (algorithm='ED25519' AND public_key_pem IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS linqasend_webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  raw_body BYTEA NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  signature_header TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL,
  timestamp_verified BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','QUARANTINED','FAILED')),
  attempt_count INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_linqasend_webhook_claim ON linqasend_webhook_inbox(status,available_at) WHERE status IN ('RECEIVED','FAILED');

CREATE TABLE IF NOT EXISTS linqasend_launch_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','APPROVED','ACTIVE','PAUSED','CLOSED')),
  corridor_rule_ids UUID[] NOT NULL DEFAULT '{}', allowed_funding_modes TEXT[] NOT NULL DEFAULT '{}',
  per_transfer_limit_minor BIGINT NOT NULL, daily_user_limit_minor BIGINT NOT NULL,
  approved_at TIMESTAMPTZ, activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_launch_cohort_members (
  cohort_id UUID NOT NULL REFERENCES linqasend_launch_cohorts(id), user_id UUID NOT NULL,
  enrolled_by UUID NOT NULL, enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(), removed_at TIMESTAMPTZ,
  PRIMARY KEY(cohort_id,user_id)
);
CREATE TABLE IF NOT EXISTS linqasend_kill_switches (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL','CORRIDOR','PROVIDER','RAIL','COHORT')),
  scope_id TEXT NOT NULL DEFAULT '*', active BOOLEAN NOT NULL DEFAULT false,
  reason TEXT, activated_by UUID, activated_at TIMESTAMPTZ, cleared_by UUID, cleared_at TIMESTAMPTZ,
  PRIMARY KEY(scope_type,scope_id)
);
INSERT INTO linqasend_kill_switches(scope_type,scope_id,active,reason)
VALUES('GLOBAL','*',true,'Default closed until independently approved launch activation')
ON CONFLICT(scope_type,scope_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS linqasend_worker_heartbeats (
  worker_name TEXT NOT NULL, instance_id TEXT NOT NULL, status TEXT NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL, details JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY(worker_name,instance_id)
);
CREATE TABLE IF NOT EXISTS linqasend_operational_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), severity TEXT NOT NULL, alert_type TEXT NOT NULL,
  subject_type TEXT, subject_id TEXT, details JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_completion_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id),
  journal_id UUID NOT NULL REFERENCES linqasend_ledger_transactions(id), prior_status TEXT NOT NULL,
  source TEXT NOT NULL, evidence JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(transfer_id,journal_id)
);

CREATE TABLE IF NOT EXISTS linqasend_launch_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id UUID NOT NULL REFERENCES linqasend_launch_cohorts(id),
  release_manifest_id UUID NOT NULL REFERENCES linqasend_release_manifests_v6(id), status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by UUID NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_launch_approvals (
  request_id UUID NOT NULL REFERENCES linqasend_launch_approval_requests(id),
  approval_role TEXT NOT NULL CHECK (approval_role IN ('ENGINEERING','SECURITY','FRAUD','COMPLIANCE','FINANCE','OPERATIONS')),
  approver_id UUID NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  evidence_reference TEXT NOT NULL, decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(request_id,approval_role), UNIQUE(request_id,approver_id)
);
CREATE TABLE IF NOT EXISTS linqasend_launch_role_assignments (
  user_id UUID NOT NULL, approval_role TEXT NOT NULL CHECK (approval_role IN ('ENGINEERING','SECURITY','FRAUD','COMPLIANCE','FINANCE','OPERATIONS')),
  assigned_by UUID NOT NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ,
  PRIMARY KEY(user_id,approval_role), CHECK(user_id<>assigned_by)
);
CREATE TABLE IF NOT EXISTS linqasend_readiness_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
  release_git_sha CHAR(40), artifact_sha256 CHAR(64), ready BOOLEAN NOT NULL,
  checks JSONB NOT NULL, blockers TEXT[] NOT NULL DEFAULT '{}', snapshot_hash CHAR(64) NOT NULL UNIQUE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_control_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), metric_name TEXT NOT NULL, scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL, metric_value NUMERIC NOT NULL, window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL, calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_automatic_pause_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), metric_name TEXT NOT NULL, comparison TEXT NOT NULL CHECK(comparison IN ('GT','GTE','LT','LTE')),
  threshold NUMERIC NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_automatic_pause_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rule_id UUID NOT NULL REFERENCES linqasend_automatic_pause_rules(id),
  metric_id UUID NOT NULL REFERENCES linqasend_control_metrics(id), kill_scope_type TEXT NOT NULL, kill_scope_id TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(rule_id,metric_id)
);

ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS fraud_signal_snapshot_id UUID REFERENCES linqasend_fraud_signal_snapshots(id);
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS completion_journal_id UUID REFERENCES linqasend_ledger_transactions(id);
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS execution_id UUID REFERENCES linqasend_transfer_executions(id);

CREATE OR REPLACE FUNCTION linqasend_guard_completed_transfer() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED'
     AND (NEW.completion_journal_id IS NULL OR NEW.completed_at IS NULL) THEN
    RAISE EXCEPTION 'LINQASEND_ATOMIC_COMPLETION_EVIDENCE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_linqasend_guard_completed_transfer ON linqasend_transfers;
CREATE TRIGGER trg_linqasend_guard_completed_transfer BEFORE UPDATE ON linqasend_transfers
FOR EACH ROW EXECUTE FUNCTION linqasend_guard_completed_transfer();

DROP TRIGGER IF EXISTS trg_linqasend_fraud_snapshot_immutable ON linqasend_fraud_signal_snapshots;
CREATE TRIGGER trg_linqasend_fraud_snapshot_immutable BEFORE UPDATE OR DELETE ON linqasend_fraud_signal_snapshots
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();
DROP TRIGGER IF EXISTS trg_linqasend_provider_secret_audit_immutable ON linqasend_provider_secret_access_audit;
CREATE TRIGGER trg_linqasend_provider_secret_audit_immutable BEFORE UPDATE OR DELETE ON linqasend_provider_secret_access_audit
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();
DROP TRIGGER IF EXISTS trg_linqasend_completion_audit_immutable ON linqasend_completion_audit;
CREATE TRIGGER trg_linqasend_completion_audit_immutable BEFORE UPDATE OR DELETE ON linqasend_completion_audit
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();

COMMIT;
