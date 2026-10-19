-- Executes the sender-fee refund that deposit requests already record as PENDING_REFUND.
-- REFUNDED requires provider-confirmed evidence; REFUND_REVIEW holds a provider-declared failure for people.
ALTER TABLE linqasend_deposit_requests DROP CONSTRAINT linqasend_deposit_requests_sender_fee_refund_status_check;
ALTER TABLE linqasend_deposit_requests ADD CONSTRAINT linqasend_deposit_requests_sender_fee_refund_status_check
  CHECK(sender_fee_refund_status IN ('NONE','PENDING_REFUND','REFUNDED','REFUND_REVIEW'));
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_lease_token UUID;
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_lease_expires_at TIMESTAMPTZ;
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_submission_started_at TIMESTAMPTZ;
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_provider_ref TEXT;
ALTER TABLE linqasend_deposit_requests ADD COLUMN refund_failure_code TEXT;
ALTER TABLE linqasend_deposit_requests ADD COLUMN refunded_at TIMESTAMPTZ;
ALTER TABLE linqasend_deposit_requests ADD CONSTRAINT linqasend_deposit_refund_evidence
  CHECK(sender_fee_refund_status<>'REFUNDED' OR (refund_provider_ref IS NOT NULL AND refunded_at IS NOT NULL));
CREATE INDEX deposit_fee_refund_due ON linqasend_deposit_requests(refund_available_at) WHERE sender_fee_refund_status='PENDING_REFUND';
