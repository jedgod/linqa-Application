-- LINQA ADMIN + STAFF SUPPORT OPERATIONS SCHEMA (PostgreSQL)
CREATE TYPE staff_role AS ENUM ('SUPER_ADMIN','ADMIN','SUPERVISOR','STAFF','AUDITOR');
CREATE TYPE staff_presence AS ENUM ('ONLINE','BUSY','AWAY','OFFLINE');
CREATE TYPE support_case_status AS ENUM ('NEW','ASSIGNED','WAITING_CLIENT','ESCALATED','RESOLVED','CLOSED');
CREATE TYPE support_priority AS ENUM ('LOW','NORMAL','HIGH','URGENT');

CREATE TABLE staff_accounts (
  id UUID PRIMARY KEY,
  user_id UUID UNIQUE,
  display_name TEXT NOT NULL,
  role staff_role NOT NULL,
  team TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  presence staff_presence NOT NULL DEFAULT 'OFFLINE',
  mfa_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_cases (
  id UUID PRIMARY KEY,
  case_number TEXT UNIQUE NOT NULL,
  client_user_id UUID NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  status support_case_status NOT NULL DEFAULT 'NEW',
  priority support_priority NOT NULL DEFAULT 'NORMAL',
  owner_staff_id UUID REFERENCES staff_accounts(id),
  queue_key TEXT NOT NULL,
  risk_code TEXT,
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_case_events (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES support_cases(id),
  actor_staff_id UUID REFERENCES staff_accounts(id),
  event_type TEXT NOT NULL,
  public_to_client BOOLEAN NOT NULL DEFAULT FALSE,
  body_redacted TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_audit_events (
  id UUID PRIMARY KEY,
  actor_staff_id UUID REFERENCES staff_accounts(id),
  actor_role staff_role NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  purpose_code TEXT,
  reason TEXT,
  result TEXT NOT NULL,
  ip_hash TEXT,
  device_session_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_target_idx ON staff_audit_events(target_type,target_id,created_at DESC);
CREATE INDEX staff_audit_actor_idx ON staff_audit_events(actor_staff_id,created_at DESC);

CREATE TABLE break_glass_requests (
  id UUID PRIMARY KEY,
  requested_by UUID NOT NULL REFERENCES staff_accounts(id),
  approved_by UUID REFERENCES staff_accounts(id),
  target_user_id UUID NOT NULL,
  requested_scope TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','DENIED','EXPIRED','USED')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE staff_quality_reviews (
  id UUID PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES staff_accounts(id),
  case_id UUID REFERENCES support_cases(id),
  reviewer_staff_id UUID NOT NULL REFERENCES staff_accounts(id),
  policy_score NUMERIC(5,2),
  resolution_score NUMERIC(5,2),
  documentation_score NUMERIC(5,2),
  escalation_score NUMERIC(5,2),
  overall_score NUMERIC(5,2) NOT NULL,
  coaching_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Do NOT create a generic staff table containing user E2EE plaintext or Vault plaintext.
-- Operational support data should reference source systems through purpose-scoped service APIs.
