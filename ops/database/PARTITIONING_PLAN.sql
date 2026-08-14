-- Example partitioned operational-event design for high-volume tables.
-- Apply only after testing migration strategy on a staging copy.

CREATE TABLE IF NOT EXISTS operational_events_partitioned (
  id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(id,created_at)
) PARTITION BY RANGE(created_at);

CREATE TABLE IF NOT EXISTS operational_events_2026_08
  PARTITION OF operational_events_partitioned
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS operational_events_2026_08_type_idx
  ON operational_events_2026_08(event_type,created_at DESC);

-- Production automation should create future partitions ahead of time and
-- archive/drop expired partitions only after retention and legal-hold checks.
