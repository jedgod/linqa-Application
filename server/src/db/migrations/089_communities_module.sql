BEGIN;

-- Communities module, phase 1 (create, discover, join/request, roles, invitations, announcements, audit).
--
-- This EXTENDS the existing `communities` (007) and `community_memberships` (008) tables rather than creating a second
-- community model: mobile-hub, execution-launch and CommunityService already read and write them. Existing values are kept
-- (visibility PUBLIC/PRIVATE/INVITE_ONLY, status ACTIVE/..., roles uppercase) and existing rows stay valid through defaults.
-- Soft deletion uses the existing communities.status = 'DELETED'; there is no second deleted_at flag.

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS cover_object_key TEXT,
  ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Widen the membership role/status vocabularies (add MODERATOR and BANNED). The original inline CHECK constraints carry
-- generated names, so find them by definition instead of assuming a name.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'community_memberships'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%role%' OR pg_get_constraintdef(oid) ILIKE '%status%')
  LOOP
    EXECUTE format('ALTER TABLE community_memberships DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE community_memberships
  ADD CONSTRAINT community_memberships_role_check
    CHECK (role IN ('OWNER','ADMIN','MODERATOR','MEMBER')),
  ADD CONSTRAINT community_memberships_status_check
    CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED','BANNED'));

CREATE INDEX IF NOT EXISTS communities_discover_idx
  ON communities (category, created_at DESC) WHERE visibility = 'PUBLIC' AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS communities_country_idx
  ON communities (country_code) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS community_memberships_user_idx
  ON community_memberships (user_id, status);

-- A person has at most one live request per community; a decided request can be re-opened by the same person, never duplicated.
CREATE TABLE IF NOT EXISTS community_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_join_requests_pending_idx
  ON community_join_requests (community_id, created_at) WHERE status = 'PENDING';

-- Invitation links. Only the SHA-256 of the token is stored; the token itself is shown once at creation.
CREATE TABLE IF NOT EXISTS community_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (uses <= max_uses),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS community_invites_community_idx ON community_invites (community_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'POST' CHECK (kind IN ('POST','ANNOUNCEMENT')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS community_posts_feed_idx
  ON community_posts (community_id, kind, pinned DESC, created_at DESC) WHERE deleted_at IS NULL;

-- Append-only record of privileged actions. The actor is kept (SET NULL) if their account is later deleted.
CREATE TABLE IF NOT EXISTS community_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_audit_logs_community_idx ON community_audit_logs (community_id, created_at DESC);

COMMIT;
