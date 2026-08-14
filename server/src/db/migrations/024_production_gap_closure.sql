BEGIN;

CREATE TABLE IF NOT EXISTS step_up_consumption (
  jti UUID PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS step_up_consumption_expiry_idx
  ON step_up_consumption(expires_at);

COMMIT;

