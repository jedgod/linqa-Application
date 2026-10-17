-- One-time proof that the sender typed the card's security code for THIS payment. The code itself goes
-- straight from the phone to the card provider and is never sent to, or stored by, LinqaSend.
CREATE TABLE linqasend_cvv_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  payment_method_id UUID NOT NULL REFERENCES linqasend_payment_methods(id),
  provider_session_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONSUMED')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_linqasend_cvv_sessions_user ON linqasend_cvv_sessions(user_id, payment_method_id, status);
