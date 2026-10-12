-- Bringing older message history to a newly linked computer. The computer asks, the person approves on their phone, and the phone
-- uploads an archive that it has already encrypted for that one computer. The server only ever holds those sealed chunks, for a
-- short time, and deletes them when the transfer ends.
CREATE TABLE IF NOT EXISTS history_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  approver_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','UPLOADING','READY','COMPLETE','CANCELLED','DECLINED','FAILED')),
  chunk_count INTEGER,
  total_bytes BIGINT,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS history_transfers_user_idx ON history_transfers (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS history_transfers_one_open_per_device
  ON history_transfers (requester_device_id) WHERE status IN ('REQUESTED','APPROVED','UPLOADING','READY');

CREATE TABLE IF NOT EXISTS history_transfer_chunks (
  transfer_id UUID NOT NULL REFERENCES history_transfers(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0 AND seq < 2000),
  data BYTEA NOT NULL,
  PRIMARY KEY (transfer_id, seq)
);
