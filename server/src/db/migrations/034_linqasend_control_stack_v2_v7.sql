BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- v3: effective-dated, server-authoritative country and corridor policy.
CREATE TABLE IF NOT EXISTS linqasend_country_capabilities_v3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), country CHAR(2) NOT NULL, version INT NOT NULL CHECK(version>0),
  effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ,
  domestic_internal_status TEXT NOT NULL, domestic_bank_in_status TEXT NOT NULL, domestic_bank_out_status TEXT NOT NULL,
  domestic_merchant_status TEXT NOT NULL, domestic_request_money_status TEXT NOT NULL,
  cross_border_inbound_status TEXT NOT NULL, cross_border_outbound_status TEXT NOT NULL, cross_border_bank_outbound_status TEXT NOT NULL,
  allowed_funding_modes TEXT[] NOT NULL DEFAULT '{}', allowed_receive_modes TEXT[] NOT NULL DEFAULT '{}',
  source_reference TEXT, approved_by UUID, approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country,version), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX IF NOT EXISTS idx_linqasend_country_capability_active_v3 ON linqasend_country_capabilities_v3(country,effective_from DESC);

CREATE TABLE IF NOT EXISTS linqasend_corridor_rules_v3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_country CHAR(2) NOT NULL, destination_country CHAR(2) NOT NULL,
  transfer_class TEXT NOT NULL, version INT NOT NULL CHECK(version>0), status TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ,
  source_currencies TEXT[] NOT NULL, destination_currencies TEXT[] NOT NULL, permitted_funding_modes TEXT[] NOT NULL,
  permitted_receive_modes TEXT[] NOT NULL, permitted_rails TEXT[] NOT NULL, min_amount_minor BIGINT, max_amount_minor BIGINT,
  min_kyc_level INT, requires_purpose_code BOOLEAN NOT NULL DEFAULT false, requires_source_of_funds BOOLEAN NOT NULL DEFAULT false,
  requires_manual_review BOOLEAN NOT NULL DEFAULT false, provider_id TEXT, legal_approval_reference TEXT, partner_approval_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(source_country,destination_country,transfer_class,version),
  CHECK(effective_to IS NULL OR effective_to>effective_from), CHECK(max_amount_minor IS NULL OR min_amount_minor IS NULL OR max_amount_minor>=min_amount_minor)
);
CREATE INDEX IF NOT EXISTS idx_linqasend_corridor_active_v3 ON linqasend_corridor_rules_v3(source_country,destination_country,transfer_class,effective_from DESC);

ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS transfer_class TEXT;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS funding_mode TEXT;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS receive_mode TEXT;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS source_country CHAR(2);
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS destination_country CHAR(2);
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS selected_rail TEXT;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS capability_snapshot JSONB;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS capability_snapshot_hash TEXT;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS jurisdiction_authorization_id UUID;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS responsibility_snapshot_id UUID;
ALTER TABLE linqasend_transfers ADD COLUMN IF NOT EXISTS real_money_ready BOOLEAN NOT NULL DEFAULT false;

-- Account jurisdiction/travel/relocation v2.
CREATE TABLE IF NOT EXISTS user_jurisdiction_profiles_v2 (
  user_id UUID PRIMARY KEY, nationality_country CHAR(2), original_registration_country CHAR(2) NOT NULL,
  verified_residence_country CHAR(2) NOT NULL, account_country CHAR(2) NOT NULL, current_physical_country CHAR(2),
  tax_residence_countries TEXT[] NOT NULL DEFAULT '{}', phone_country CHAR(2), regulatory_entity_id TEXT NOT NULL,
  regulatory_jurisdiction CHAR(2) NOT NULL, location_relationship TEXT NOT NULL DEFAULT 'HOME', migration_status TEXT NOT NULL DEFAULT 'NONE',
  residence_verified_at TIMESTAMPTZ, jurisdiction_effective_from TIMESTAMPTZ NOT NULL DEFAULT now(), jurisdiction_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_location_observations_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, signal_type TEXT NOT NULL, country CHAR(2),
  confidence NUMERIC(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1), observed_at TIMESTAMPTZ NOT NULL, metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_location_observations_user_time_v2 ON user_location_observations_v2(user_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS jurisdiction_relocation_requests_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, from_country CHAR(2) NOT NULL, requested_country CHAR(2) NOT NULL,
  status TEXT NOT NULL, reason TEXT, decision_version INT NOT NULL DEFAULT 0, target_regulatory_entity_id TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ, decided_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_active_relocation_request_v2 ON jurisdiction_relocation_requests_v2(user_id) WHERE status IN ('REQUESTED','DOCUMENTS_REQUIRED','UNDER_REVIEW','APPROVED_FOR_MIGRATION');
CREATE TABLE IF NOT EXISTS residency_evidence_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), relocation_request_id UUID NOT NULL REFERENCES jurisdiction_relocation_requests_v2(id),
  evidence_type TEXT NOT NULL, evidence_class TEXT, country CHAR(2) NOT NULL, verification_status TEXT NOT NULL DEFAULT 'PENDING',
  object_key TEXT NOT NULL, content_sha256 TEXT NOT NULL, issued_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
  verified_by UUID, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jurisdiction_audit_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, event_type TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}',
  previous_hash TEXT, event_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_wallet_accounts_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, jurisdiction CHAR(2) NOT NULL, regulatory_entity_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL, ledger_balance_minor BIGINT NOT NULL DEFAULT 0, pending_balance_minor BIGINT NOT NULL DEFAULT 0,
  available_balance_minor BIGINT NOT NULL DEFAULT 0, withdrawable_balance_minor BIGINT NOT NULL DEFAULT 0, held_balance_minor BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE', jurisdiction_version INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id,jurisdiction,currency,jurisdiction_version)
);
CREATE TABLE IF NOT EXISTS linqasend_action_authorizations_v2 (
  id UUID PRIMARY KEY, user_id UUID NOT NULL, action TEXT NOT NULL, wallet_id UUID, device_id TEXT NOT NULL, session_id TEXT NOT NULL,
  outcome TEXT NOT NULL, allowed BOOLEAN NOT NULL, location_assessment JSONB NOT NULL, reason_codes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v4: transaction security and fraud evidence.
CREATE TABLE IF NOT EXISTS linqasend_trusted_payment_devices_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, installation_id UUID NOT NULL, device_id UUID NOT NULL,
  device_binding_key_id TEXT NOT NULL, trust_state TEXT NOT NULL CHECK(trust_state IN ('TRUSTED','UNKNOWN','RISKY','REVOKED')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_step_up_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ, revocation_reason TEXT, UNIQUE(user_id,installation_id,device_id)
);
CREATE TABLE IF NOT EXISTS linqasend_security_change_events_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, event_type TEXT NOT NULL, severity TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(), metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_linqasend_security_changes_user_time_v4 ON linqasend_security_change_events_v4(user_id,event_at DESC);
CREATE TABLE IF NOT EXISTS linqasend_payment_risk_assessments_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id UUID NOT NULL, user_id UUID NOT NULL, score INT NOT NULL CHECK(score BETWEEN 0 AND 100),
  decision TEXT NOT NULL, model_version TEXT NOT NULL, reasons JSONB NOT NULL DEFAULT '[]', signals JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_recipient_trust_v4 (
  sender_user_id UUID NOT NULL, recipient_id TEXT NOT NULL, first_transfer_at TIMESTAMPTZ, last_transfer_at TIMESTAMPTZ,
  successful_transfer_count INT NOT NULL DEFAULT 0, failed_transfer_count INT NOT NULL DEFAULT 0, total_sent_minor BIGINT NOT NULL DEFAULT 0,
  last_currency CHAR(3), trust_state TEXT NOT NULL DEFAULT 'NEW', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(sender_user_id,recipient_id)
);
CREATE TABLE IF NOT EXISTS linqasend_scam_warning_events_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id UUID NOT NULL, user_id UUID NOT NULL, warning_code TEXT NOT NULL,
  severity TEXT NOT NULL, acknowledged BOOLEAN NOT NULL DEFAULT false, displayed_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_transaction_challenges_v4 (
  id UUID PRIMARY KEY, transfer_id UUID NOT NULL, user_id UUID NOT NULL, challenge_nonce TEXT NOT NULL UNIQUE, challenge_hash TEXT NOT NULL,
  expected_transaction_hash TEXT NOT NULL, device_id UUID NOT NULL, installation_id UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_transaction_authorizations_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id UUID NOT NULL, user_id UUID NOT NULL, jti TEXT NOT NULL UNIQUE,
  transaction_hash TEXT NOT NULL, device_binding_key_id TEXT NOT NULL, auth_method TEXT NOT NULL, authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_funding_fingerprints_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), funding_source_id UUID NOT NULL, provider TEXT NOT NULL, provider_fingerprint TEXT NOT NULL,
  owner_user_id UUID NOT NULL, first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider,provider_fingerprint,owner_user_id)
);
CREATE TABLE IF NOT EXISTS linqasend_provider_webhook_events_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider TEXT NOT NULL, provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL, timestamp_verified BOOLEAN NOT NULL, payload_hash TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ, replay_detected BOOLEAN NOT NULL DEFAULT false, UNIQUE(provider,provider_event_id)
);
CREATE TABLE IF NOT EXISTS linqasend_ledger_integrity_v4 (journal_id UUID PRIMARY KEY,previous_hash TEXT,journal_hash TEXT NOT NULL UNIQUE,posting_count INT NOT NULL,computed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS linqasend_privileged_money_actions_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), action_type TEXT NOT NULL, transfer_id UUID, requested_by UUID NOT NULL, approved_by UUID,
  status TEXT NOT NULL, reason_code TEXT NOT NULL, notes TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ, CHECK(approved_by IS NULL OR approved_by<>requested_by)
);
CREATE TABLE IF NOT EXISTS linqasend_security_audit_v4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, transfer_id UUID, event_type TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}', prev_event_hash TEXT, event_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v5: settlement, treasury, safeguarding and reconciliation.
CREATE TABLE IF NOT EXISTS linqasend_settlement_accounts_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entity_id TEXT NOT NULL, provider_id TEXT, account_type TEXT NOT NULL, country CHAR(2), currency CHAR(3) NOT NULL,
  external_account_ref TEXT NOT NULL, display_name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, last_reported_balance_minor BIGINT NOT NULL DEFAULT 0,
  last_balance_at TIMESTAMPTZ, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(entity_id,external_account_ref,currency)
);
CREATE TABLE IF NOT EXISTS linqasend_treasury_positions_v5 (
  position_date DATE NOT NULL, currency CHAR(3) NOT NULL, safeguarding_asset_minor BIGINT NOT NULL, customer_liability_minor BIGINT NOT NULL,
  provider_receivable_minor BIGINT NOT NULL, provider_payable_minor BIGINT NOT NULL, fx_liquidity_minor BIGINT NOT NULL, reserve_minor BIGINT NOT NULL,
  suspense_debit_minor BIGINT NOT NULL, suspense_credit_minor BIGINT NOT NULL, available_liquidity_minor BIGINT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(position_date,currency)
);
CREATE TABLE IF NOT EXISTS linqasend_liquidity_policies_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), country CHAR(2), currency CHAR(3) NOT NULL, version INT NOT NULL,
  min_available_minor BIGINT NOT NULL, target_available_minor BIGINT NOT NULL, max_available_minor BIGINT NOT NULL,
  max_open_fx_position_minor BIGINT, effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ, approved_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country,currency,version), CHECK(min_available_minor<=target_available_minor AND target_available_minor<=max_available_minor)
);
CREATE TABLE IF NOT EXISTS linqasend_fx_positions_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id UUID, source_currency CHAR(3) NOT NULL, destination_currency CHAR(3) NOT NULL,
  source_amount_minor BIGINT NOT NULL, destination_amount_minor BIGINT NOT NULL, rate NUMERIC(28,12) NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
  provider_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_settlement_instructions_v5 (
  id UUID PRIMARY KEY, transfer_id UUID NOT NULL, provider_id TEXT NOT NULL, settlement_account_id UUID NOT NULL REFERENCES linqasend_settlement_accounts_v5(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0), currency CHAR(3) NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE, provider_reference TEXT, batch_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_settlement_batches_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider_id TEXT NOT NULL, currency CHAR(3) NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
  instruction_count INT NOT NULL DEFAULT 0, total_minor BIGINT NOT NULL DEFAULT 0, checksum TEXT, sealed_at TIMESTAMPTZ,
  provider_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), submitted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_external_settlement_records_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_type TEXT NOT NULL, source_id TEXT NOT NULL, external_id TEXT NOT NULL,
  provider_reference TEXT, amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL, direction TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
  raw_record JSONB NOT NULL, file_hash TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(source_type,source_id,external_id)
);
CREATE TABLE IF NOT EXISTS linqasend_reconciliation_runs_v5 (
  id UUID PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL, matched_count INT NOT NULL DEFAULT 0, break_count INT NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_reconciliation_matches_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES linqasend_reconciliation_runs_v5(id), external_record_id UUID,
  settlement_instruction_id UUID, status TEXT NOT NULL, internal_amount_minor BIGINT, external_amount_minor BIGINT, currency CHAR(3), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_reconciliation_breaks_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES linqasend_reconciliation_runs_v5(id), break_type TEXT NOT NULL,
  severity TEXT NOT NULL, status TEXT NOT NULL, external_record_id UUID, settlement_instruction_id UUID, delta_minor BIGINT, currency CHAR(3),
  details JSONB NOT NULL DEFAULT '{}', assigned_to UUID, resolution_code TEXT, resolution_notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_suspense_items_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reconciliation_break_id UUID NOT NULL REFERENCES linqasend_reconciliation_breaks_v5(id), currency CHAR(3) NOT NULL,
  debit_minor BIGINT NOT NULL DEFAULT 0, credit_minor BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_revenue_events_v5 (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),transfer_id UUID,event_type TEXT NOT NULL,amount_minor BIGINT NOT NULL,currency CHAR(3) NOT NULL,journal_id UUID,recognized_at TIMESTAMPTZ NOT NULL DEFAULT now(),metadata JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS linqasend_reserve_positions_v5 (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),provider_id TEXT NOT NULL,currency CHAR(3) NOT NULL,required_minor BIGINT NOT NULL,actual_minor BIGINT NOT NULL,status TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS linqasend_treasury_actions_v5 (
  id UUID PRIMARY KEY, action_type TEXT NOT NULL, currency CHAR(3) NOT NULL, amount_minor BIGINT NOT NULL, requested_by UUID NOT NULL,
  approved_by UUID, status TEXT NOT NULL, reason_code TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ, executed_at TIMESTAMPTZ, CHECK(approved_by IS NULL OR approved_by<>requested_by)
);
CREATE TABLE IF NOT EXISTS linqasend_eod_controls_v5 (
  id UUID PRIMARY KEY, control_date DATE NOT NULL UNIQUE, status TEXT NOT NULL, checks JSONB NOT NULL, evidence_hash TEXT NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v6: ingestion, exact-SHA evidence, certification and release gates.
CREATE TABLE IF NOT EXISTS linqasend_ingestion_batches_v6 (
  id UUID PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, file_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
  record_count INT NOT NULL DEFAULT 0, imported_count INT NOT NULL DEFAULT 0, duplicate_count INT NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL, error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_evidence_manifests_v6 (
  id UUID PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, git_sha CHAR(40) NOT NULL, artifact_digest TEXT NOT NULL,
  items JSONB NOT NULL, manifest_hash CHAR(64) NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_provider_certifications_v6 (
  id UUID PRIMARY KEY, provider_id TEXT NOT NULL, adapter_version TEXT NOT NULL, git_sha CHAR(40) NOT NULL,
  evidence_manifest_id UUID NOT NULL REFERENCES linqasend_evidence_manifests_v6(id), status TEXT NOT NULL, certified_by TEXT NOT NULL,
  certified_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS linqasend_corridor_certifications_v6 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), corridor_rule_id UUID NOT NULL REFERENCES linqasend_corridor_rules_v3(id), git_sha CHAR(40) NOT NULL,
  evidence_manifest_id UUID REFERENCES linqasend_evidence_manifests_v6(id), status TEXT NOT NULL, physical_tests_passed BOOLEAN NOT NULL DEFAULT false,
  failure_tests_passed BOOLEAN NOT NULL DEFAULT false, certified_by TEXT NOT NULL, certified_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS linqasend_physical_certification_runs_v6 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), corridor_rule_id UUID, provider_id TEXT, git_sha CHAR(40) NOT NULL, environment TEXT NOT NULL,
  test_cases JSONB NOT NULL, passed BOOLEAN NOT NULL, evidence_manifest_id UUID, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS linqasend_release_manifests_v6 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), release_version TEXT NOT NULL, git_sha CHAR(40) NOT NULL, artifact_digest TEXT NOT NULL,
  environment TEXT NOT NULL, corridor_ids UUID[] NOT NULL DEFAULT '{}', provider_ids TEXT[] NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL, operations_signoff_by TEXT, compliance_signoff_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_at TIMESTAMPTZ,
  UNIQUE(git_sha,artifact_digest,environment)
);
CREATE TABLE IF NOT EXISTS linqasend_ga_gate_runs_v6 (
  id UUID PRIMARY KEY, git_sha CHAR(40) NOT NULL, artifact_digest TEXT NOT NULL, environment TEXT NOT NULL, allowed BOOLEAN NOT NULL,
  blockers TEXT[] NOT NULL DEFAULT '{}', evaluated_by TEXT NOT NULL, evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v7: regulated entity and partner responsibility network.
CREATE TABLE IF NOT EXISTS linqasend_financial_entities_v7 (
  id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, display_name TEXT NOT NULL, entity_type TEXT NOT NULL, country_code CHAR(2) NOT NULL,
  status TEXT NOT NULL, website TEXT, legal_entity_identifier TEXT, regulatory_reference TEXT, due_diligence_status TEXT NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'UNKNOWN', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_customer_compliance_profiles_v7 (
  user_id UUID PRIMARY KEY, verified_legal_name TEXT NOT NULL, verified_country CHAR(2) NOT NULL,
  kyc_level INT NOT NULL CHECK(kyc_level>=0), kyc_status TEXT NOT NULL, provider_customer_ref TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ, source_evidence_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_partner_contracts_v7 (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES linqasend_financial_entities_v7(id), contract_set_id TEXT NOT NULL,
  status TEXT NOT NULL, responsibilities TEXT[] NOT NULL, source_countries TEXT[] NOT NULL DEFAULT '{}', destination_countries TEXT[] NOT NULL DEFAULT '{}',
  currencies TEXT[] NOT NULL DEFAULT '{}', effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ, executed_document_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE TABLE IF NOT EXISTS linqasend_financial_responsibility_maps_v7 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_country CHAR(2) NOT NULL, destination_country CHAR(2) NOT NULL, transfer_class TEXT NOT NULL,
  source_currency CHAR(3) NOT NULL, destination_currency CHAR(3) NOT NULL, funding_mode TEXT NOT NULL, receive_mode TEXT NOT NULL,
  custody_model TEXT NOT NULL, responsibility_entities JSONB NOT NULL DEFAULT '{}', legal_approval_reference TEXT NOT NULL,
  partner_approval_reference TEXT NOT NULL, contract_set_id TEXT NOT NULL, policy_version INT NOT NULL, effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_country,destination_country,transfer_class,source_currency,destination_currency,funding_mode,receive_mode,policy_version)
);
CREATE INDEX IF NOT EXISTS idx_responsibility_map_active_v7 ON linqasend_financial_responsibility_maps_v7(source_country,destination_country,transfer_class,source_currency,destination_currency,funding_mode,receive_mode,effective_from DESC);
CREATE TABLE IF NOT EXISTS linqasend_partner_health_v7 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entity_id TEXT NOT NULL REFERENCES linqasend_financial_entities_v7(id), operational_status TEXT NOT NULL,
  latency_ms INT, error_rate NUMERIC(8,5), details JSONB NOT NULL DEFAULT '{}', checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_responsibility_snapshots_v7 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id UUID NOT NULL, responsibility_map_id UUID, policy_version INT NOT NULL,
  resolution JSONB NOT NULL, snapshot_hash CHAR(64) NOT NULL UNIQUE, complete BOOLEAN NOT NULL, blocked_reasons TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linqasend_real_money_readiness_v7 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), corridor_rule_id UUID NOT NULL, responsibility_map_id UUID, capability_ready BOOLEAN NOT NULL,
  responsibility_ready BOOLEAN NOT NULL, provider_ready BOOLEAN NOT NULL, settlement_ready BOOLEAN NOT NULL, certification_ready BOOLEAN NOT NULL,
  ready BOOLEAN NOT NULL, blockers TEXT[] NOT NULL DEFAULT '{}', evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(corridor_rule_id)
);

CREATE OR REPLACE FUNCTION linqasend_reject_immutable_mutation_v4() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LINQASEND_IMMUTABLE_EVIDENCE_MUTATION_FORBIDDEN';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_linqasend_ledger_entries_immutable_v4 ON linqasend_ledger_entries;
CREATE TRIGGER trg_linqasend_ledger_entries_immutable_v4 BEFORE UPDATE OR DELETE ON linqasend_ledger_entries
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();
DROP TRIGGER IF EXISTS trg_linqasend_security_audit_immutable_v4 ON linqasend_security_audit_v4;
CREATE TRIGGER trg_linqasend_security_audit_immutable_v4 BEFORE UPDATE OR DELETE ON linqasend_security_audit_v4
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();
DROP TRIGGER IF EXISTS trg_linqasend_external_records_immutable_v5 ON linqasend_external_settlement_records_v5;
CREATE TRIGGER trg_linqasend_external_records_immutable_v5 BEFORE UPDATE OR DELETE ON linqasend_external_settlement_records_v5
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();
DROP TRIGGER IF EXISTS trg_linqasend_evidence_manifest_immutable_v6 ON linqasend_evidence_manifests_v6;
CREATE TRIGGER trg_linqasend_evidence_manifest_immutable_v6 BEFORE UPDATE OR DELETE ON linqasend_evidence_manifests_v6
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();
DROP TRIGGER IF EXISTS trg_linqasend_responsibility_snapshot_immutable_v7 ON linqasend_responsibility_snapshots_v7;
CREATE TRIGGER trg_linqasend_responsibility_snapshot_immutable_v7 BEFORE UPDATE OR DELETE ON linqasend_responsibility_snapshots_v7
FOR EACH ROW EXECUTE FUNCTION linqasend_reject_immutable_mutation_v4();

COMMIT;
