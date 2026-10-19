-- Amount-based wallet operations; no synthetic opening balances or provider registrations.
CREATE TABLE linqasend_wallet_money_quotes (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
  wallet_id UUID NOT NULL REFERENCES linqasend_wallet_accounts_v2(id),
  snapshot JSONB NOT NULL, destination_ref TEXT, expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER wallet_money_quotes_immutable BEFORE UPDATE OR DELETE ON linqasend_wallet_money_quotes
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TABLE linqasend_wallet_money_abandoned_quotes (
  quote_id UUID PRIMARY KEY REFERENCES linqasend_wallet_money_quotes(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER wallet_money_abandoned_immutable BEFORE UPDATE OR DELETE ON linqasend_wallet_money_abandoned_quotes
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_money_abandoned_no_truncate BEFORE TRUNCATE ON linqasend_wallet_money_abandoned_quotes
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TABLE linqasend_wallet_money_operations (
  id UUID PRIMARY KEY REFERENCES linqasend_wallet_money_quotes(id),
  user_id UUID NOT NULL REFERENCES users(id), wallet_id UUID NOT NULL REFERENCES linqasend_wallet_accounts_v2(id),
  kind TEXT NOT NULL CHECK(kind IN ('WITHDRAW','INTERNAL','TOPUP','EXTERNAL')),
  status TEXT NOT NULL CHECK(status IN ('QUEUED','PROCESSING','RECONCILING','ACTION_REQUIRED','COMPLETED','FAILED','CANCELED','PARTIALLY_RETURNED','RETURNED','RETURN_REVIEW')),
  snapshot JSONB NOT NULL, authorization_context JSONB NOT NULL DEFAULT '{}', provider_ref TEXT, action_url TEXT,
  returned_minor BIGINT NOT NULL DEFAULT 0 CHECK(returned_minor>=0),
  returned_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK(returned_fee_minor>=0 AND returned_fee_minor<=returned_minor),
  refund_requested_at TIMESTAMPTZ,refund_submission_started_at TIMESTAMPTZ,refund_reason_code TEXT,
  lease_token UUID, lease_expires_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(), failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_money_due ON linqasend_wallet_money_operations(next_check_at);
CREATE TABLE linqasend_wallet_money_events (
  operation_id UUID NOT NULL REFERENCES linqasend_wallet_money_operations(id),
  event_id TEXT NOT NULL, evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(operation_id,event_id)
);
CREATE TRIGGER wallet_money_events_immutable BEFORE UPDATE OR DELETE ON linqasend_wallet_money_events
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_money_events_no_truncate BEFORE TRUNCATE ON linqasend_wallet_money_events
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_money_quotes_no_truncate BEFORE TRUNCATE ON linqasend_wallet_money_quotes
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE FUNCTION linqasend_wallet_money_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.wallet_id<>OLD.wallet_id OR NEW.kind<>OLD.kind OR NEW.snapshot<>OLD.snapshot OR NEW.authorization_context<>OLD.authorization_context THEN
    RAISE EXCEPTION 'WALLET_OPERATION_IDENTITY_IS_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_money_identity_immutable BEFORE UPDATE ON linqasend_wallet_money_operations
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_money_identity_immutable();
CREATE TRIGGER wallet_money_no_delete BEFORE DELETE ON linqasend_wallet_money_operations
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_money_no_truncate BEFORE TRUNCATE ON linqasend_wallet_money_operations
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TABLE linqasend_wallet_money_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), quote_id UUID NOT NULL REFERENCES linqasend_wallet_money_quotes(id),
  user_id UUID NOT NULL REFERENCES users(id),device_id UUID NOT NULL,session_id UUID NOT NULL,installation_id UUID NOT NULL,
  snapshot JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '90 seconds',consumed_at TIMESTAMPTZ
);
-- Explicit launch limits: no configured row means no new wallet money operations.
CREATE TABLE linqasend_wallet_money_limits (
  regulatory_entity_id TEXT NOT NULL,currency CHAR(3) NOT NULL,
  per_operation_minor BIGINT NOT NULL CHECK(per_operation_minor>0),
  daily_minor BIGINT NOT NULL CHECK(daily_minor>=per_operation_minor),
  active BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(regulatory_entity_id,currency)
);
CREATE TABLE linqasend_bank_link_sessions (
  id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id),provider_session_id TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, payment_method_id UUID REFERENCES linqasend_payment_methods(id),
  method_type TEXT NOT NULL CHECK(method_type IN ('BANK_ACCOUNT','DEBIT_CARD')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE linqasend_verified_bank_capabilities (
  payment_method_id UUID PRIMARY KEY REFERENCES linqasend_payment_methods(id),
  user_id UUID NOT NULL REFERENCES users(id),provider_id TEXT NOT NULL,country CHAR(2) NOT NULL,currency CHAR(3) NOT NULL,
  funding_enabled BOOLEAN NOT NULL,payout_enabled BOOLEAN NOT NULL,
  ownership_verified_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,evidence_sha256 CHAR(64) NOT NULL
);
