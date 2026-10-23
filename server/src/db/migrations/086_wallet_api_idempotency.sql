-- Optional client-supplied Idempotency-Key for the standalone Wallet API (/v2/wallet/*).
-- This is a retry guard in front of the wallet handlers, not a second source of truth: the money state itself stays
-- idempotent through the quote/operation identity in 084. Only successful (2xx) responses are stored for replay.
CREATE TABLE linqasend_wallet_api_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  request_method TEXT NOT NULL CHECK (request_method IN ('GET','POST')),
  request_path TEXT NOT NULL CHECK (length(request_path) <= 255),
  -- SHA-256 of method, path and canonical body: the same key with a different request is rejected, never replayed.
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','COMPLETED')),
  -- A crashed request cannot hold its key forever: once the lease lapses, a retry may take it over.
  lease_expires_at TIMESTAMPTZ NOT NULL,
  response_code INTEGER CHECK (response_code BETWEEN 200 AND 299),
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT linqasend_wallet_api_idempotency_user_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT linqasend_wallet_api_idempotency_completed_has_response
    CHECK (status = 'PROCESSING' OR (response_code IS NOT NULL AND response_body IS NOT NULL))
);
CREATE INDEX linqasend_wallet_api_idempotency_retention ON linqasend_wallet_api_idempotency (created_at);
