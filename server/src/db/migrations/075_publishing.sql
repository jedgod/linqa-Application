-- Publishing (posts and events). The schema below is the supplied linqa-publishing pack's
-- server/sql/001_publishing.sql, unchanged; only the final ALTER is new.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Assumes existing users(id UUID); adapt the FK to your live identity schema.
CREATE TABLE IF NOT EXISTS publishing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES users(id),
 title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
 description varchar(5000) NOT NULL DEFAULT '', starts_at timestamptz NOT NULL,
 ends_at timestamptz, timezone text NOT NULL, venue_name text,
 latitude double precision, longitude double precision,
 visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','country','community','private')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
 feeling_activity text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at IS NULL OR ends_at > starts_at),
 CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
 CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
 CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE TABLE IF NOT EXISTS publishing_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES publishing_events(id) ON DELETE CASCADE,
 object_key text NOT NULL UNIQUE, mime_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes > 0),
 kind text NOT NULL CHECK(kind IN ('image','video')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publishing_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 object_key text NOT NULL UNIQUE, mime_type text NOT NULL, bytes bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('image','video')),
 consumed_event_id uuid REFERENCES publishing_events(id), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publishing_idempotency (
 owner_id uuid NOT NULL REFERENCES users(id), idempotency_key uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES publishing_events(id),
 PRIMARY KEY(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS publishing_events_creator_idx ON publishing_events(creator_id,created_at DESC);
CREATE INDEX IF NOT EXISTS publishing_events_feed_idx ON publishing_events(starts_at) WHERE status='published';
CREATE INDEX IF NOT EXISTS publishing_uploads_owner_idx ON publishing_uploads(owner_id,expires_at);

-- Added for this server: the number of bytes a client actually delivered for an upload, so an event can only be
-- published with media whose bytes really arrived and match what was declared (the pack checked this against S3).
ALTER TABLE publishing_uploads ADD COLUMN IF NOT EXISTS received_bytes bigint;
