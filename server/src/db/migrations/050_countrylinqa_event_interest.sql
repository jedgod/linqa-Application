-- "Interested" on an event (Linqa World, Events page). Interest is private to the person who set it;
-- others only ever see a count.
CREATE TABLE IF NOT EXISTS country_event_interest (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_country_event_interest_event ON country_event_interest(event_id);
