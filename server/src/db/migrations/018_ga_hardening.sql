BEGIN;

CREATE TABLE IF NOT EXISTS ga_release_gates (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (
    category IN (
      'SECURITY','CRYPTO','PRIVACY','LEGAL','OPERATIONS',
      'SUPPORT','MOBILE_RELEASE','INFRASTRUCTURE','QUALITY'
    )
  ),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','PASS','FAIL','WAIVED')
  ),
  evidence_uri TEXT,
  evidence_hash BYTEA,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_security_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_type TEXT NOT NULL CHECK (
    assessment_type IN ('CRYPTO_AUDIT','PEN_TEST','ARCH_REVIEW','MOBILE_REVIEW')
  ),
  assessor_name TEXT NOT NULL,
  report_reference TEXT NOT NULL,
  report_hash BYTEA NOT NULL,
  started_at DATE,
  completed_at DATE,
  status TEXT NOT NULL CHECK (
    status IN ('PLANNED','IN_PROGRESS','COMPLETED','ACCEPTED','REJECTED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_findings_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID REFERENCES external_security_assessments(id) ON DELETE SET NULL,
  finding_key TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL CHECK (
    severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')
  ),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  remediation_owner TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN','IN_PROGRESS','MITIGATED','ACCEPTED_RISK','CLOSED')
  ),
  due_at TIMESTAMPTZ,
  evidence_uri TEXT,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soc2_controls_v2 (
  control_id TEXT PRIMARY KEY,
  trust_service_criteria TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  control_owner TEXT NOT NULL,
  frequency TEXT NOT NULL,
  automated BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'DESIGNED' CHECK (
    status IN ('DESIGNED','IMPLEMENTED','EFFECTIVE','DEFICIENT')
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_evidence_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id TEXT REFERENCES soc2_controls_v2(control_id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 BYTEA NOT NULL,
  collection_period_start TIMESTAMPTZ,
  collection_period_end TIMESTAMPTZ,
  collected_by TEXT NOT NULL,
  immutable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privacy_requests_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'ACCESS','PORTABILITY','DELETE','CORRECT',
      'OPT_OUT_SALE','OPT_OUT_SHARING','LIMIT_SENSITIVE_USE'
    )
  ),
  jurisdiction TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (
    state IN (
      'RECEIVED','IDENTITY_VERIFICATION','VERIFIED','PROCESSING',
      'READY','COMPLETED','DENIED','CANCELLED','FAILED'
    )
  ),
  due_at TIMESTAMPTZ NOT NULL,
  verification_level TEXT NOT NULL DEFAULT 'STANDARD',
  requested_from_device_id UUID REFERENCES devices(id),
  output_object_key TEXT,
  denial_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS privacy_requests_due_idx
  ON privacy_requests_v2(state,due_at)
  WHERE state NOT IN ('COMPLETED','DENIED','CANCELLED');

CREATE TABLE IF NOT EXISTS privacy_request_steps_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES privacy_requests_v2(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED')
  ),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(request_id,step_key)
);

CREATE TABLE IF NOT EXISTS data_residency_assignments_v2 (
  subject_type TEXT NOT NULL CHECK (
    subject_type IN ('USER','ORGANIZATION')
  ),
  subject_id UUID NOT NULL,
  region_code TEXT NOT NULL,
  residency_policy TEXT NOT NULL CHECK (
    residency_policy IN ('STRICT','PREFERRED','GLOBAL_ALLOWED')
  ),
  assigned_by TEXT NOT NULL,
  reason TEXT,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_type,subject_id)
);

CREATE TABLE IF NOT EXISTS region_catalog_v2 (
  region_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  primary_database_dsn_secret_ref TEXT NOT NULL,
  object_storage_bucket TEXT NOT NULL,
  kms_key_ref TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  supports_user_data BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_policies_v2 (
  data_class TEXT PRIMARY KEY,
  retention_days INTEGER,
  legal_hold_supported BOOLEAN NOT NULL DEFAULT FALSE,
  deletion_mode TEXT NOT NULL CHECK (
    deletion_mode IN ('HARD_DELETE','CRYPTO_ERASE','ARCHIVE_THEN_DELETE')
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FIX (2026-08-07 apply pass): the pack referenced a nonexistent
-- organizations_v2(id) FK. The real table (007_three_milestones.sql) is
-- `organizations`. A separate, org-scoped `legal_holds` table already
-- exists (007_three_milestones.sql); this v2 table is a distinct,
-- broader-scoped (user-or-org) legal hold record, not a duplicate.
CREATE TABLE IF NOT EXISTS legal_holds_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  subject_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  hold_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  released_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS archive_jobs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_class TEXT NOT NULL,
  partition_key TEXT,
  cutoff_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('QUEUED','RUNNING','COMPLETED','FAILED')
  ),
  archived_rows BIGINT NOT NULL DEFAULT 0,
  deleted_rows BIGINT NOT NULL DEFAULT 0,
  object_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS incidents_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN ('SEV0','SEV1','SEV2','SEV3','SEV4')
  ),
  state TEXT NOT NULL CHECK (
    state IN (
      'DECLARED','INVESTIGATING','MITIGATING',
      'MONITORING','RESOLVED','POSTMORTEM'
    )
  ),
  commander TEXT NOT NULL,
  communications_lead TEXT,
  security_related BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_related BOOLEAN NOT NULL DEFAULT FALSE,
  customer_impact TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mitigated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS incident_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents_v2(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_events_incident_time_idx
  ON incident_events_v2(incident_id,created_at);

-- FIX: organizations_v2 -> organizations (see above).
CREATE TABLE IF NOT EXISTS support_cases_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  case_number BIGSERIAL UNIQUE,
  category TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (
    priority IN ('LOW','NORMAL','HIGH','URGENT')
  ),
  state TEXT NOT NULL CHECK (
    state IN ('OPEN','WAITING_USER','WAITING_INTERNAL','RESOLVED','CLOSED')
  ),
  assigned_team TEXT,
  assigned_agent TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS support_case_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (
    actor_type IN ('USER','STAFF','SYSTEM')
  ),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  body TEXT,
  private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagnostic_bundles_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  sha256 BYTEA NOT NULL,
  redaction_version INTEGER NOT NULL,
  consented BOOLEAN NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slo_definitions_v2 (
  key TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  target NUMERIC(8,5) NOT NULL,
  window_days INTEGER NOT NULL,
  indicator_query TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slo_measurements_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_key TEXT NOT NULL REFERENCES slo_definitions_v2(key) ON DELETE CASCADE,
  measured_value NUMERIC(12,8) NOT NULL,
  compliant BOOLEAN NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: named production_kill_switches_v2 (not operational_kill_switches)
-- and consumed by the new ProductionKillSwitchService — kept separate from
-- the existing KillSwitchService/operational_kill_switches feature
-- (003_stages_6_10.sql) rather than colliding with it.
CREATE TABLE IF NOT EXISTS production_kill_switches_v2 (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_changed_by TEXT,
  last_changed_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ga_rollouts_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_version TEXT NOT NULL,
  audience TEXT NOT NULL,
  rollout_percentage INTEGER NOT NULL CHECK (
    rollout_percentage BETWEEN 0 AND 100
  ),
  state TEXT NOT NULL CHECK (
    state IN ('PLANNED','RUNNING','PAUSED','COMPLETED','ROLLED_BACK','FAILED')
  ),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO production_kill_switches_v2(key,description)
VALUES
  ('MESSAGING_SEND','Disable outbound message sends'),
  ('CALL_START','Disable new call starts'),
  ('FILE_UPLOAD','Disable new attachment and Vault uploads'),
  ('AI_CLOUD','Disable confidential-cloud AI jobs'),
  ('BILLING_CHECKOUT','Disable new billing checkout sessions'),
  ('ENTERPRISE_PROVISIONING','Disable SSO/SCIM provisioning changes'),
  ('EMERGENCY_VIDEO','Disable emergency video transmission'),
  ('GA_NEW_SIGNUPS','Disable new production signups')
ON CONFLICT(key) DO NOTHING;

INSERT INTO ga_release_gates(key,category)
VALUES
  ('crypto_audit','CRYPTO'),
  ('penetration_test','SECURITY'),
  ('critical_findings_closed','SECURITY'),
  ('privacy_review','PRIVACY'),
  ('legal_review','LEGAL'),
  ('soc2_control_evidence','OPERATIONS'),
  ('restore_drill','INFRASTRUCTURE'),
  ('slo_dashboards','OPERATIONS'),
  ('support_oncall','SUPPORT'),
  ('ios_release_ready','MOBILE_RELEASE'),
  ('android_release_ready','MOBILE_RELEASE'),
  ('ga_rollback_test','QUALITY')
ON CONFLICT(key) DO NOTHING;

COMMIT;
