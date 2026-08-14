-- LinqaSend: cross-border money transfer. Adapted from the
-- LinqaSend Production Code Pack (originally a separate apps/api Postgres
-- schema) into this repository's single database, following the same
-- migration/table conventions as every other module here.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE linqasend_payment_method_type AS ENUM ('DEBIT_CARD','CREDIT_CARD','BANK_ACCOUNT','MOBILE_WALLET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linqasend_payment_method_status AS ENUM ('PENDING','VERIFIED','RESTRICTED','SUSPENDED','EXPIRED','REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linqasend_recipient_type AS ENUM ('LINQA_USER','PHONE','EMAIL','BANK','CARD','MOBILE_WALLET','BUSINESS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linqasend_transfer_status AS ENUM (
    'CREATED','QUOTE_CREATED','AWAITING_CONFIRMATION','AUTHENTICATING','COMPLIANCE_SCREENING',
    'RISK_REVIEW','FUNDING_AUTHORIZATION','FUNDS_AUTHORIZED','TRANSFER_SUBMITTED','PROCESSING',
    'PAYOUT_SUBMITTED','PAYOUT_PROCESSING','COMPLETED','REQUIRES_ACTION','MANUAL_REVIEW','ON_HOLD',
    'DECLINED','CANCELED','EXPIRED','FAILED','REVERSED','REFUNDED','PARTIALLY_REFUNDED','DISPUTED','CHARGEBACK'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linqasend_quote_status AS ENUM ('ACTIVE','LOCKED','EXPIRED','CONSUMED','CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS linqasend_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider VARCHAR(64) NOT NULL,
  provider_customer_ref VARCHAR(255),
  provider_payment_method_ref VARCHAR(255) NOT NULL,
  type linqasend_payment_method_type NOT NULL,
  last4 CHAR(4),
  billing_country CHAR(2),
  verification_status linqasend_payment_method_status NOT NULL DEFAULT 'PENDING',
  international_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_linqasend_payment_methods_user ON linqasend_payment_methods(user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_linqasend_payment_methods_provider_ref ON linqasend_payment_methods(provider, provider_payment_method_ref);

CREATE TABLE IF NOT EXISTS linqasend_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  recipient_type linqasend_recipient_type NOT NULL,
  linqa_user_id UUID,
  display_name VARCHAR(160) NOT NULL,
  country CHAR(2) NOT NULL,
  preferred_currency CHAR(3) NOT NULL,
  payout_profile_ref VARCHAR(255),
  payout_provider VARCHAR(64),
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_linqasend_recipients_owner ON linqasend_recipients(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS linqasend_corridors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_country CHAR(2) NOT NULL,
  destination_country CHAR(2) NOT NULL,
  source_currency CHAR(3) NOT NULL,
  destination_currency CHAR(3) NOT NULL,
  min_amount_minor BIGINT NOT NULL,
  max_amount_minor BIGINT NOT NULL,
  base_margin_bps INT NOT NULL,
  min_margin_bps INT NOT NULL,
  max_margin_bps INT NOT NULL,
  volatility_buffer_bps INT NOT NULL DEFAULT 0,
  settlement_buffer_bps INT NOT NULL DEFAULT 0,
  liquidity_buffer_bps INT NOT NULL DEFAULT 0,
  provider VARCHAR(64) NOT NULL,
  estimated_delivery_text VARCHAR(160),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_country,destination_country,source_currency,destination_currency,provider)
);

-- Rates must be loaded by a real FX data/admin process (see providers.ts's
-- FailClosedFxRateProvider) — never fabricated at request time.
CREATE TABLE IF NOT EXISTS linqasend_fx_rate_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(64) NOT NULL,
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  market_rate NUMERIC(24,10) NOT NULL,
  provider_rate NUMERIC(24,10) NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_linqasend_fx_latest ON linqasend_fx_rate_snapshots(base_currency,quote_currency,received_at DESC);

CREATE TABLE IF NOT EXISTS linqasend_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  recipient_id UUID NOT NULL REFERENCES linqasend_recipients(id),
  corridor_id UUID NOT NULL REFERENCES linqasend_corridors(id),
  payment_method_id UUID REFERENCES linqasend_payment_methods(id),
  send_amount_minor BIGINT NOT NULL,
  send_currency CHAR(3) NOT NULL,
  receive_amount_minor BIGINT NOT NULL,
  receive_currency CHAR(3) NOT NULL,
  market_reference_rate NUMERIC(24,10) NOT NULL,
  provider_execution_rate NUMERIC(24,10) NOT NULL,
  customer_rate NUMERIC(24,10) NOT NULL,
  margin_bps INT NOT NULL,
  sender_fee_minor BIGINT NOT NULL DEFAULT 0,
  recipient_fee_minor BIGINT NOT NULL DEFAULT 0,
  status linqasend_quote_status NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_linqasend_quotes_user ON linqasend_quotes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS linqasend_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(40) UNIQUE NOT NULL,
  user_id UUID NOT NULL,
  recipient_id UUID NOT NULL REFERENCES linqasend_recipients(id),
  quote_id UUID NOT NULL REFERENCES linqasend_quotes(id),
  payment_method_id UUID REFERENCES linqasend_payment_methods(id),
  status linqasend_transfer_status NOT NULL DEFAULT 'CREATED',
  send_amount_minor BIGINT NOT NULL,
  send_currency CHAR(3) NOT NULL,
  receive_amount_minor BIGINT NOT NULL,
  receive_currency CHAR(3) NOT NULL,
  customer_rate NUMERIC(24,10) NOT NULL,
  margin_bps INT NOT NULL,
  sender_fee_minor BIGINT NOT NULL DEFAULT 0,
  recipient_fee_minor BIGINT NOT NULL DEFAULT 0,
  purpose_code VARCHAR(64),
  provider VARCHAR(64),
  provider_transfer_ref VARCHAR(255),
  provider_payout_ref VARCHAR(255),
  idempotency_key VARCHAR(160) NOT NULL,
  failure_code VARCHAR(64),
  failure_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_linqasend_transfers_user ON linqasend_transfers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linqasend_transfers_status ON linqasend_transfers(status, updated_at);

CREATE TABLE IF NOT EXISTS linqasend_transfer_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id) ON DELETE CASCADE,
  phase VARCHAR(64) NOT NULL,
  provider VARCHAR(64),
  provider_ref VARCHAR(255),
  status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE linqasend_ledger_account_type AS ENUM ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linqasend_ledger_entry_side AS ENUM ('DEBIT','CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS linqasend_ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  type linqasend_ledger_account_type NOT NULL,
  currency CHAR(3),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linqasend_ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref VARCHAR(120) UNIQUE NOT NULL,
  transfer_id UUID REFERENCES linqasend_transfers(id),
  description TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_by UUID REFERENCES linqasend_ledger_transactions(id)
);

-- Ledger entries are immutable: corrections must post a reversing entry,
-- never UPDATE/DELETE a posted row (see ledger.service.ts).
CREATE TABLE IF NOT EXISTS linqasend_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_transaction_id UUID NOT NULL REFERENCES linqasend_ledger_transactions(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES linqasend_ledger_accounts(id),
  side linqasend_ledger_entry_side NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_linqasend_ledger_entries_tx ON linqasend_ledger_entries(ledger_transaction_id);
CREATE INDEX IF NOT EXISTS idx_linqasend_ledger_entries_account ON linqasend_ledger_entries(account_id, created_at DESC);

INSERT INTO linqasend_ledger_accounts(code,name,type) VALUES
('CLEARING_CARD','Card/Bank Funding Clearing','ASSET'),
('TRANSFER_PAYABLE','Transfer Payable','LIABILITY'),
('FX_REVENUE','FX Spread Revenue','REVENUE'),
('PROCESSOR_EXPENSE','Processor Expense','EXPENSE'),
('PAYOUT_CLEARING','Payout Clearing','ASSET')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS linqasend_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id),
  combined_score INT NOT NULL,
  risk_level VARCHAR(20) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linqasend_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id),
  subject_type VARCHAR(32) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linqasend_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(64) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

COMMENT ON TABLE linqasend_transfers IS
'No real payment/FX provider is configured in this environment (see services/linqasend/payment-provider.ts) — transfers fail closed at funding authorization rather than simulating money movement.';

COMMIT;
