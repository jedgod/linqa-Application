CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE ops_staff_role AS ENUM ('SUPER_ADMIN','OPS_ADMIN','SUPERVISOR','SUPPORT_AGENT','TRUST_SAFETY','FRAUD_ANALYST','FINANCE_OPS','VAULT_OPS','RECOVERY_SPECIALIST','AUDITOR','EXECUTIVE_READONLY');
CREATE TYPE ops_case_status AS ENUM ('NEW','OPEN','PENDING_USER','PENDING_INTERNAL','ESCALATED','RESOLVED','CLOSED');
CREATE TYPE ops_severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

CREATE TABLE ops_staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
 display_name text NOT NULL, role ops_staff_role NOT NULL, team_id uuid,
 employment_status text NOT NULL DEFAULT 'ACTIVE', presence text NOT NULL DEFAULT 'OFFLINE',
 max_concurrent_cases int NOT NULL DEFAULT 5 CHECK(max_concurrent_cases BETWEEN 1 AND 50),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_staff_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES ops_staff(id),
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 ip_hash text, device_fingerprint_hash text, mfa_level text NOT NULL,
 revoked_at timestamptz
);

CREATE TABLE ops_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL,
 case_type text NOT NULL, status ops_case_status NOT NULL DEFAULT 'NEW', severity ops_severity NOT NULL DEFAULT 'LOW',
 subject text NOT NULL, assigned_staff_id uuid REFERENCES ops_staff(id), team_id uuid,
 sla_due_at timestamptz, region text, risk_score numeric(5,2), tags text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX ops_cases_queue_idx ON ops_cases(status,severity,sla_due_at);
CREATE INDEX ops_cases_client_idx ON ops_cases(client_id,created_at DESC);

CREATE TABLE ops_case_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES ops_cases(id) ON DELETE CASCADE,
 sender_type text NOT NULL CHECK(sender_type IN ('CLIENT','STAFF','SYSTEM')), sender_id uuid,
 body_ciphertext bytea, body_preview_redacted text, attachment_refs jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_case_events (
 id bigserial PRIMARY KEY, case_id uuid NOT NULL REFERENCES ops_cases(id), actor_staff_id uuid REFERENCES ops_staff(id),
 event_type text NOT NULL, reason_code text, payload jsonb NOT NULL DEFAULT '{}', correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_recovery_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES ops_cases(id),
 phone_verified boolean NOT NULL DEFAULT false, recovery_email_verified boolean NOT NULL DEFAULT false,
 trusted_device_signal text, carrier_signal text, abuse_score numeric(5,2), evidence_refs jsonb NOT NULL DEFAULT '[]',
 decision text, decided_by uuid REFERENCES ops_staff(id), decided_at timestamptz
);

CREATE TABLE ops_send_investigations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES ops_cases(id), transaction_ref text NOT NULL,
 state text NOT NULL, amount_minor bigint, currency char(3), recipient_country char(2),
 risk_flags jsonb NOT NULL DEFAULT '[]', provider_state jsonb NOT NULL DEFAULT '{}', action text,
 action_by uuid REFERENCES ops_staff(id), action_at timestamptz
);

CREATE TABLE ops_vault_quarantine (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid REFERENCES ops_cases(id), client_id uuid NOT NULL,
 object_ref text NOT NULL, sha256 text NOT NULL, mime_type text, scanner_verdict text NOT NULL,
 findings jsonb NOT NULL DEFAULT '[]', state text NOT NULL DEFAULT 'QUARANTINED',
 reviewed_by uuid REFERENCES ops_staff(id), reviewed_at timestamptz
);
COMMENT ON TABLE ops_vault_quarantine IS 'No Vault plaintext or encryption keys are stored in operations tables.';

CREATE TABLE ops_trust_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES ops_cases(id),
 report_category text NOT NULL, evidence_refs jsonb NOT NULL DEFAULT '[]', policy_matches jsonb NOT NULL DEFAULT '[]',
 enforcement_state text NOT NULL DEFAULT 'REVIEW', reviewer_id uuid REFERENCES ops_staff(id), reviewed_at timestamptz
);

CREATE TABLE ops_risk_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES ops_cases(id),
 score numeric(5,2) NOT NULL, signals jsonb NOT NULL DEFAULT '[]', model_version text,
 disposition text, analyst_id uuid REFERENCES ops_staff(id), decided_at timestamptz
);

CREATE TABLE ops_qa_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES ops_staff(id), case_id uuid REFERENCES ops_cases(id),
 reviewer_id uuid NOT NULL REFERENCES ops_staff(id), rubric jsonb NOT NULL, score numeric(5,2), notes text,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_coaching_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES ops_staff(id), coach_id uuid NOT NULL REFERENCES ops_staff(id),
 qa_review_id uuid REFERENCES ops_qa_reviews(id), goals jsonb NOT NULL DEFAULT '[]', notes text,
 scheduled_at timestamptz NOT NULL, completed_at timestamptz
);

CREATE TABLE ops_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES ops_staff(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, queue_ids uuid[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'SCHEDULED',
 CHECK(ends_at > starts_at)
);

CREATE TABLE ops_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, severity ops_severity NOT NULL,
 status text NOT NULL DEFAULT 'INVESTIGATING', commander_id uuid REFERENCES ops_staff(id),
 services text[] NOT NULL DEFAULT '{}', region text, summary text, started_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

CREATE TABLE ops_incident_events (
 id bigserial PRIMARY KEY, incident_id uuid NOT NULL REFERENCES ops_incidents(id) ON DELETE CASCADE,
 actor_staff_id uuid REFERENCES ops_staff(id), event_type text NOT NULL, body text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_audit_log (
 id bigserial PRIMARY KEY, actor_staff_id uuid REFERENCES ops_staff(id), actor_session_id uuid,
 action text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL, reason_code text,
 correlation_id uuid NOT NULL, ip_hash text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_audit_actor_idx ON ops_audit_log(actor_staff_id,created_at DESC);
CREATE INDEX ops_audit_resource_idx ON ops_audit_log(resource_type,resource_id,created_at DESC);

CREATE TABLE ops_break_glass (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES ops_staff(id),
 resource_type text NOT NULL, resource_id text NOT NULL, justification text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING', approver_id uuid REFERENCES ops_staff(id), expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ops_audit_log is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER ops_audit_no_update BEFORE UPDATE OR DELETE ON ops_audit_log FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
