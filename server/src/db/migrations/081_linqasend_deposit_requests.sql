-- The receiver's choice for moving received money from their wallet to a bank/card on file:
-- instant (fee covered by the sender, or paid by the receiver) or free after 3 business days.
CREATE TABLE linqasend_deposit_requests (
  id UUID PRIMARY KEY,
  transfer_id UUID NOT NULL UNIQUE REFERENCES linqasend_transfers(id),
  receiver_user_id UUID NOT NULL REFERENCES users(id),
  payment_method_id UUID NOT NULL REFERENCES linqasend_payment_methods(id),
  option TEXT NOT NULL CHECK (option IN ('instant','standard')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  receiver_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (receiver_fee_minor >= 0),
  net_deposit_minor BIGINT NOT NULL CHECK (net_deposit_minor > 0),
  sender_fee_refund_minor BIGINT NOT NULL DEFAULT 0 CHECK (sender_fee_refund_minor >= 0),
  sender_fee_refund_status TEXT NOT NULL DEFAULT 'NONE' CHECK (sender_fee_refund_status IN ('NONE','PENDING_REFUND','REFUNDED')),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','SCHEDULED','COMPLETED','FAILED')),
  release_on DATE,
  provider_ref TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_linqasend_deposit_requests_due ON linqasend_deposit_requests(release_on) WHERE status = 'SCHEDULED';
CREATE INDEX idx_linqasend_deposit_requests_receiver ON linqasend_deposit_requests(receiver_user_id, created_at DESC);
