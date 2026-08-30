-- LinqaSend v4/v5 execution controls omitted from the initial additive control-stack migration.
ALTER TABLE linqasend_settlement_batches_v5
  ADD COLUMN IF NOT EXISTS batch_type TEXT NOT NULL DEFAULT 'PAYOUT',
  ADD COLUMN IF NOT EXISTS settlement_date DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE UNIQUE INDEX IF NOT EXISTS linqasend_settlement_batch_business_key_v5
  ON linqasend_settlement_batches_v5(provider_id, currency, settlement_date, batch_type);

CREATE TABLE IF NOT EXISTS linqasend_settlement_batch_items_v5 (
  batch_id UUID NOT NULL REFERENCES linqasend_settlement_batches_v5(id),
  instruction_id UUID NOT NULL UNIQUE REFERENCES linqasend_settlement_instructions_v5(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(batch_id, instruction_id)
);

CREATE TABLE IF NOT EXISTS linqasend_money_adjustments_v5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES linqasend_transfers(id),
  action_id UUID NOT NULL UNIQUE REFERENCES linqasend_privileged_money_actions_v4(id),
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('FULL_REFUND','REVERSAL','CHARGEBACK')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
  currency CHAR(3) NOT NULL,
  provider_id TEXT,
  provider_reference TEXT,
  ledger_external_ref TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS linqasend_chargeback_provider_dedupe_v5
  ON linqasend_money_adjustments_v5(provider_id, provider_reference)
  WHERE adjustment_type='CHARGEBACK' AND provider_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION linqasend_block_immutable_adjustment_update_v5() RETURNS trigger AS $$
BEGIN
  IF OLD.status='EXECUTED' THEN RAISE EXCEPTION 'executed money adjustments are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS linqasend_money_adjustment_immutable_v5 ON linqasend_money_adjustments_v5;
CREATE TRIGGER linqasend_money_adjustment_immutable_v5
  BEFORE UPDATE OR DELETE ON linqasend_money_adjustments_v5
  FOR EACH ROW EXECUTE FUNCTION linqasend_block_immutable_adjustment_update_v5();
