-- One-time wallet invoices (LinqaStealthPay): a merchant's single-use request for a fixed amount.
--
-- Privacy model, stated plainly: the invoice code is a bearer token and only its SHA-256 is stored, so reading this table
-- cannot be used to pay or look up an invoice. A merchant sees their own invoices and whether each is paid, but this
-- table holds no payer column, so the merchant's view never exposes the payer's account. The platform's audit trail is
-- NOT hidden from the platform: a paid invoice points at the wallet money operation that paid it (paid_operation_id), and
-- that operation, with its immutable ledger journal, records the payer. Payer identity is never cleared or anonymized.
--
-- Money: BIGINT minor units with an ISO currency on the row. The fee is not stored here. It is priced from the fee
-- schedule when the payer asks for a quote, and the quote/operation snapshot is the record of what was charged.
CREATE TABLE linqasend_wallet_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash CHAR(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_hint TEXT NOT NULL CHECK (length(code_hint) BETWEEN 4 AND 24),           -- masked form for support and receipts, e.g. inv_st1...9x3p
  merchant_user_id UUID NOT NULL REFERENCES users(id),
  merchant_wallet_id UUID NOT NULL REFERENCES linqasend_wallet_accounts_v2(id),
  regulatory_entity_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),                        -- what the merchant receives, before any fee
  merchant_reference TEXT CHECK (merchant_reference IS NULL OR length(merchant_reference) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','EXPIRED','CANCELED')),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_operation_id UUID UNIQUE REFERENCES linqasend_wallet_money_operations(id), -- UNIQUE: an invoice can be paid at most once
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT linqasend_wallet_invoices_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CONSTRAINT linqasend_wallet_invoices_paid_consistent CHECK ((status = 'PAID') = (paid_operation_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX linqasend_wallet_invoices_merchant ON linqasend_wallet_invoices (merchant_user_id, created_at DESC);
CREATE INDEX linqasend_wallet_invoices_open_expiry ON linqasend_wallet_invoices (expires_at) WHERE status = 'OPEN';

-- The state machine is enforced in the database, not just in application code:
--   OPEN -> PAID | EXPIRED | CANCELED, and nothing leaves a final state;
--   the terms (code, merchant, wallet, amount, currency, expiry) never change;
--   an invoice cannot become PAID after it expired; a paid invoice cannot be deleted.
CREATE FUNCTION linqasend_wallet_invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PAID' THEN RAISE EXCEPTION 'WALLET_INVOICE_PAID_IS_IMMUTABLE'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.code_hash <> OLD.code_hash OR NEW.code_hint <> OLD.code_hint OR NEW.merchant_user_id <> OLD.merchant_user_id
     OR NEW.merchant_wallet_id <> OLD.merchant_wallet_id OR NEW.regulatory_entity_id <> OLD.regulatory_entity_id OR NEW.currency <> OLD.currency
     OR NEW.amount_minor <> OLD.amount_minor OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at
     OR NEW.merchant_reference IS DISTINCT FROM OLD.merchant_reference THEN
    RAISE EXCEPTION 'WALLET_INVOICE_TERMS_ARE_IMMUTABLE';
  END IF;
  IF OLD.status <> 'OPEN' AND (NEW.status <> OLD.status OR NEW.paid_operation_id IS DISTINCT FROM OLD.paid_operation_id OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'WALLET_INVOICE_STATE_IS_FINAL';
  END IF;
  IF OLD.status = 'OPEN' AND NEW.status = 'PAID' AND now() > OLD.expires_at THEN
    RAISE EXCEPTION 'WALLET_INVOICE_EXPIRED';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER linqasend_wallet_invoices_guard BEFORE UPDATE OR DELETE ON linqasend_wallet_invoices
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_invoices_guard();
