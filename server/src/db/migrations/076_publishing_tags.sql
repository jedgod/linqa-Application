-- People tagged in a post or event. One row per person; only people connected to the publisher can be tagged (checked by the API).
CREATE TABLE IF NOT EXISTS publishing_event_tags (
  event_id uuid NOT NULL REFERENCES publishing_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS publishing_event_tags_user_idx ON publishing_event_tags(user_id);
-- GIFs are uploaded as images of their own kind.
ALTER TABLE publishing_uploads DROP CONSTRAINT IF EXISTS publishing_uploads_kind_check;
ALTER TABLE publishing_media DROP CONSTRAINT IF EXISTS publishing_media_kind_check;
ALTER TABLE publishing_uploads ADD CONSTRAINT publishing_uploads_kind_check CHECK (kind IN ('image','video'));
ALTER TABLE publishing_media ADD CONSTRAINT publishing_media_kind_check CHECK (kind IN ('image','video'));
