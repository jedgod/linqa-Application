-- One durable retry identity per owned quote. Existing transfers are reused.
CREATE TABLE linqasend_payment_intents (
  user_id UUID NOT NULL REFERENCES users(id),
  quote_id UUID NOT NULL REFERENCES linqasend_quotes(id),
  idempotency_key UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quote_id)
);
