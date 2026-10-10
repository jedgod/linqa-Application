BEGIN;
CREATE TABLE IF NOT EXISTS vault_provider_certifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_kind text NOT NULL,
 provider_name text NOT NULL, environment text NOT NULL, status text NOT NULL
 CHECK(status IN('PENDING','APPROVED','REVOKED','EXPIRED')),
 git_sha text NOT NULL, artifact_digest text NOT NULL, evidence_digest text NOT NULL,
 approved_by text, approved_at timestamptz, expires_at timestamptz,
 UNIQUE(provider_kind,provider_name,environment,git_sha,artifact_digest)
);
CREATE TABLE IF NOT EXISTS vault_quarantine_objects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL, user_id text NOT NULL,
 source_kind text NOT NULL, source_ref text NOT NULL, object_key text NOT NULL UNIQUE,
 expected_size bigint NOT NULL CHECK(expected_size>=0), expected_sha256 text,
 observed_size bigint, observed_sha256 text, mime_declared text, mime_observed text,
 state text NOT NULL CHECK(state IN('CREATED','UPLOADED','VERIFIED','SCANNING','CLEAN','BLOCKED','FAILED','HANDED_OFF','PURGED')),
 malware_verdict text, dlp_verdict text, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vq_owner ON vault_quarantine_objects(account_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS vault_handoff_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quarantine_id uuid NOT NULL REFERENCES vault_quarantine_objects(id),
 account_id text NOT NULL,user_id text NOT NULL,device_id text NOT NULL,
 token_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_billing_events(
 provider text NOT NULL, provider_event_id text NOT NULL, raw_sha256 text NOT NULL,
 verified boolean NOT NULL, state text NOT NULL CHECK(state IN('RECEIVED','PROCESSED','QUARANTINED','FAILED')),
 received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 PRIMARY KEY(provider,provider_event_id)
);
CREATE TABLE IF NOT EXISTS vault_entitlements(
 account_id text PRIMARY KEY, plan_code text NOT NULL, status text NOT NULL,
 provider_customer_id text, provider_subscription_id text,
 current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_share_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL,user_id text NOT NULL,
 object_id text NOT NULL,kind text NOT NULL,recipient_ref text,state text NOT NULL,
 token_hash bytea,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS vault_security_events(
 id bigserial PRIMARY KEY, account_id text NOT NULL,user_id text NOT NULL,device_id text,
 kind text NOT NULL,severity text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_worker_heartbeats(
 worker text PRIMARY KEY, git_sha text NOT NULL, artifact_digest text NOT NULL,
 heartbeat_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
