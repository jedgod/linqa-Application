BEGIN;

CREATE TABLE release_channels (
  code TEXT PRIMARY KEY CHECK (
    code IN ('INTERNAL','ALPHA','BETA','CANARY','GENERAL_AVAILABILITY')
  ),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO release_channels(code, description) VALUES
  ('INTERNAL','Employees and internal testers'),
  ('ALPHA','Small invited technical cohort'),
  ('BETA','Invited external beta cohort'),
  ('CANARY','Small production traffic percentage'),
  ('GENERAL_AVAILABILITY','General production availability')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE milestone_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_code TEXT NOT NULL REFERENCES product_milestones(code),
  feature_key TEXT NOT NULL REFERENCES milestone_feature_flags(key),
  release_channel TEXT NOT NULL REFERENCES release_channels(code),
  rollout_percentage INTEGER NOT NULL CHECK (rollout_percentage BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING','APPROVED','ACTIVE','PAUSED','ROLLED_BACK','REJECTED')
  ),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX milestone_promotions_active_idx
  ON milestone_promotions(feature_key, release_channel)
  WHERE status = 'ACTIVE';

CREATE TABLE release_gate_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_code TEXT NOT NULL REFERENCES product_milestones(code),
  gate_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','WAIVED','PENDING')),
  evidence_url TEXT,
  evidence_hash BYTEA,
  owner TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(milestone_code, gate_key)
);

CREATE TABLE business_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  website TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED')),
  support_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Not part of the supplied pack: CommunityService.create() (see
-- server/src/services/community.service.ts) inserts the owner into
-- community_memberships as part of the same transaction that creates the
-- community, but no migration in either pack created that table - every
-- community creation would have failed with an undefined-table error.
-- Added here since community_channels (this same migration) already assumes
-- a membership concept exists ("MEMBERS" visibility).
CREATE TABLE community_memberships (
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE community_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (
    channel_type IN ('CHAT','ANNOUNCEMENT','VOICE_STAGE','EVENT','SUPPORT')
  ),
  visibility TEXT NOT NULL DEFAULT 'MEMBERS'
    CHECK (visibility IN ('PUBLIC','MEMBERS','ADMINS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(community_id, name)
);

CREATE TABLE organization_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_subject TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX organization_audit_events_org_time_idx
  ON organization_audit_events(organization_id, created_at DESC);

CREATE TABLE scim_directory_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id TEXT,
  user_name TEXT NOT NULL,
  display_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  linked_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  raw_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_name)
);

CREATE TABLE ai_worker_leases (
  job_id UUID PRIMARY KEY REFERENCES ai_processing_jobs(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collaboration_subscriptions (
  room_id UUID NOT NULL REFERENCES collaboration_rooms(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  last_delivered_clock BIGINT NOT NULL DEFAULT 0,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  PRIMARY KEY (room_id, device_id)
);

COMMIT;
