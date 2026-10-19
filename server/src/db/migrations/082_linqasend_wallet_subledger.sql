-- Existing balance columns become projections, never opening-balance evidence.
ALTER TABLE linqasend_wallet_accounts_v2 ADD COLUMN subledger_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE linqasend_wallet_accounts_v2 ADD CONSTRAINT wallet_nonnegative_buckets CHECK (
  NOT subledger_enabled OR (pending_balance_minor >= 0 AND available_balance_minor >= 0 AND held_balance_minor >= 0
  AND withdrawable_balance_minor >= 0));

CREATE TABLE linqasend_wallet_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('RECEIPT','RESERVE','SETTLE','RELEASE','REVERSAL')),
  transfer_id UUID REFERENCES linqasend_transfers(id),
  operation_id UUID,
  currency CHAR(3) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE linqasend_wallet_postings (
  id BIGSERIAL PRIMARY KEY,
  journal_id UUID NOT NULL REFERENCES linqasend_wallet_journals(id),
  wallet_id UUID REFERENCES linqasend_wallet_accounts_v2(id),
  bucket TEXT NOT NULL CHECK(bucket IN ('AVAILABLE','HELD','PENDING','CUSTODY_CLEARING','PAYOUT_CLEARING','FEE_REVENUE')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor <> 0),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((wallet_id IS NOT NULL) = (bucket IN ('AVAILABLE','HELD','PENDING')))
);
CREATE INDEX wallet_postings_account ON linqasend_wallet_postings(wallet_id,id);
CREATE INDEX wallet_journals_transfer ON linqasend_wallet_journals(transfer_id);

CREATE FUNCTION linqasend_wallet_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WALLET_HISTORY_IS_IMMUTABLE'; END $$;
CREATE TRIGGER wallet_journals_immutable BEFORE UPDATE OR DELETE ON linqasend_wallet_journals
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_postings_immutable BEFORE UPDATE OR DELETE ON linqasend_wallet_postings
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_postings_no_truncate BEFORE TRUNCATE ON linqasend_wallet_postings
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER wallet_journals_no_truncate BEFORE TRUNCATE ON linqasend_wallet_journals
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();

-- Also forbid appending new legs to a journal committed by an earlier transaction.
CREATE FUNCTION linqasend_wallet_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j_currency CHAR(3); j_xmin TEXT; w_currency CHAR(3); enabled BOOLEAN;
BEGIN
  SELECT currency,xmin::text INTO j_currency,j_xmin FROM linqasend_wallet_journals WHERE id=NEW.journal_id;
  IF j_xmin <> pg_current_xact_id()::text THEN RAISE EXCEPTION 'WALLET_JOURNAL_ALREADY_POSTED'; END IF;
  IF NEW.currency <> j_currency THEN RAISE EXCEPTION 'WALLET_JOURNAL_CURRENCY_MISMATCH'; END IF;
  IF NEW.wallet_id IS NOT NULL THEN
    SELECT currency,subledger_enabled INTO w_currency,enabled FROM linqasend_wallet_accounts_v2 WHERE id=NEW.wallet_id FOR UPDATE;
    IF w_currency <> NEW.currency OR NOT enabled THEN RAISE EXCEPTION 'WALLET_NOT_READY_OR_CURRENCY_MISMATCH'; END IF;
    UPDATE linqasend_wallet_accounts_v2 SET
      available_balance_minor=available_balance_minor + CASE WHEN NEW.bucket='AVAILABLE' THEN NEW.amount_minor ELSE 0 END,
      withdrawable_balance_minor=withdrawable_balance_minor + CASE WHEN NEW.bucket='AVAILABLE' THEN NEW.amount_minor ELSE 0 END,
      held_balance_minor=held_balance_minor + CASE WHEN NEW.bucket='HELD' THEN NEW.amount_minor ELSE 0 END,
      pending_balance_minor=pending_balance_minor + CASE WHEN NEW.bucket='PENDING' THEN NEW.amount_minor ELSE 0 END,
      ledger_balance_minor=ledger_balance_minor + CASE WHEN NEW.bucket IN ('AVAILABLE','HELD') THEN NEW.amount_minor ELSE 0 END
    WHERE id=NEW.wallet_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_project BEFORE INSERT ON linqasend_wallet_postings FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_project();
CREATE FUNCTION linqasend_wallet_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n BIGINT; total NUMERIC;
BEGIN
  SELECT count(*),coalesce(sum(amount_minor),0) INTO n,total FROM linqasend_wallet_postings WHERE journal_id=NEW.id;
  IF n < 2 OR total <> 0 THEN RAISE EXCEPTION 'UNBALANCED_WALLET_JOURNAL'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_journal_balanced AFTER INSERT ON linqasend_wallet_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_balanced();

ALTER TABLE linqasend_transfers ADD COLUMN wallet_credit_evidence JSONB;
ALTER TABLE linqasend_deposit_requests ADD COLUMN wallet_id UUID REFERENCES linqasend_wallet_accounts_v2(id);
ALTER TABLE linqasend_deposit_requests ADD COLUMN provider_id TEXT;
ALTER TABLE linqasend_deposit_requests ADD COLUMN destination_ref TEXT;
ALTER TABLE linqasend_deposit_requests ADD COLUMN lease_token UUID;
ALTER TABLE linqasend_deposit_requests ADD COLUMN lease_expires_at TIMESTAMPTZ;
ALTER TABLE linqasend_deposit_requests ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linqasend_deposit_requests ADD COLUMN submission_started_at TIMESTAMPTZ;
ALTER TABLE linqasend_deposit_requests ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE linqasend_deposit_requests DROP CONSTRAINT linqasend_deposit_requests_status_check;
ALTER TABLE linqasend_deposit_requests ADD CONSTRAINT linqasend_deposit_requests_status_check
  CHECK(status IN ('SCHEDULED','PROCESSING','RECONCILING','COMPLETED','FAILED','CANCELED'));
CREATE INDEX wallet_withdrawal_recovery ON linqasend_deposit_requests(available_at) WHERE status IN ('SCHEDULED','PROCESSING','RECONCILING');
-- Legacy requests remain untouched: no automatic synthetic credit/backfill of money.
CREATE TABLE linqasend_withdrawal_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID NOT NULL, session_id UUID NOT NULL, installation_id UUID NOT NULL,
  snapshot JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '90 seconds', consumed_at TIMESTAMPTZ
);
CREATE TABLE linqasend_wallet_policy_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id UUID NOT NULL REFERENCES linqasend_wallet_accounts_v2(id),
  withdrawal_id UUID,provider_id TEXT NOT NULL,evidence JSONB NOT NULL,evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER wallet_policy_audit_immutable BEFORE UPDATE OR DELETE ON linqasend_wallet_policy_audit
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
-- Replace generic transfer payables with actual recipient liabilities only for credited wallet receipts.
CREATE VIEW linqasend_customer_liabilities_v8 AS
  SELECT e.currency,CASE WHEN e.side='CREDIT' THEN e.amount_minor ELSE -e.amount_minor END AS amount_minor
  FROM linqasend_ledger_entries e JOIN linqasend_ledger_accounts a ON a.id=e.account_id
  JOIN linqasend_ledger_transactions j ON j.id=e.ledger_transaction_id
  WHERE a.type='LIABILITY' AND NOT EXISTS (SELECT 1 FROM linqasend_wallet_journals wj WHERE wj.transfer_id=j.transfer_id AND wj.kind='RECEIPT')
  UNION ALL SELECT currency,amount_minor FROM linqasend_wallet_postings WHERE wallet_id IS NOT NULL;
