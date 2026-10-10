BEGIN;
CREATE TABLE IF NOT EXISTS vault_outbox(id bigserial PRIMARY KEY,workspace_id uuid,event_type text NOT NULL,payload jsonb NOT NULL,dedupe_key text NOT NULL,state text NOT NULL DEFAULT 'READY' CHECK(state IN('READY','LEASED','DONE','DEAD')),attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_type,dedupe_key));
CREATE INDEX IF NOT EXISTS vault_outbox_ready_idx ON vault_outbox(state,available_at) WHERE state IN('READY','LEASED');
CREATE TABLE IF NOT EXISTS vault_reconciliation_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,state text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,summary jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS vault_release_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),git_sha text NOT NULL,artifact_digest text NOT NULL,test_suite text NOT NULL,result text NOT NULL CHECK(result IN('PASS','FAIL')),environment text NOT NULL,evidence jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
COMMIT;
