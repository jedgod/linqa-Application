CREATE TABLE countrylinqa_rate_buckets (
  key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key,window_start)
);
CREATE INDEX countrylinqa_rate_buckets_expiry ON countrylinqa_rate_buckets(expires_at);
ALTER TABLE countrylinqa_checkouts DROP CONSTRAINT IF EXISTS countrylinqa_checkouts_idempotency_key_key;
CREATE UNIQUE INDEX countrylinqa_checkouts_user_key ON countrylinqa_checkouts(user_id,idempotency_key);
