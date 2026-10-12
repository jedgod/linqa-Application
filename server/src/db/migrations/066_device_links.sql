-- Linking a computer (Linqa Web / desktop) to an account by scanning a QR code with the phone.
-- The QR holds a one-time secret; only its hash is stored. The phone approves, then the computer claims a short-lived
-- enrollment session exactly once and registers its own device keys through the normal device-enrollment flow.
CREATE TABLE IF NOT EXISTS device_link_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_hash BYTEA NOT NULL,
  device_name TEXT NOT NULL CHECK (length(device_name) BETWEEN 1 AND 100),
  platform TEXT NOT NULL CHECK (platform IN ('WEB','DESKTOP')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','CLAIMED','DENIED')),
  approved_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  approved_by_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS device_link_requests_expiry_idx ON device_link_requests (expires_at);
