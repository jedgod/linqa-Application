BEGIN;

CREATE TABLE product_milestones (
  code TEXT PRIMARY KEY CHECK (code IN ('1.0','2.0','3.0')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','BETA','ACTIVE','RETIRED')),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO product_milestones(code,name,status) VALUES
('1.0','Secure Communications','ACTIVE'),
('2.0','Collaboration and AI','PLANNED'),
('3.0','Enterprise Identity and Compliance','PLANNED')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE milestone_feature_flags (
  key TEXT PRIMARY KEY,
  milestone_code TEXT NOT NULL REFERENCES product_milestones(code),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  minimum_client_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collaboration_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  title_ciphertext BYTEA NOT NULL,
  room_type TEXT NOT NULL CHECK (
    room_type IN ('MEETING','WHITEBOARD','TASK_ROOM','EVENT','COMMUNITY_STAGE')
  ),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','ARCHIVED','EXPIRED','DELETED')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collaboration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES collaboration_rooms(id) ON DELETE CASCADE,
  actor_device_id UUID NOT NULL REFERENCES devices(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'WHITEBOARD_DELTA','NOTE_DELTA','TASK_CREATE','TASK_UPDATE',
      'TASK_COMPLETE','POLL_CREATE','POLL_VOTE',
      'SCREEN_SHARE_START','SCREEN_SHARE_STOP'
    )
  ),
  ciphertext BYTEA NOT NULL,
  logical_clock BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id,actor_device_id,logical_clock)
);

CREATE TABLE ai_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID,
  job_type TEXT NOT NULL CHECK (
    job_type IN ('SUMMARY','TRANSLATION','ACTION_ITEMS','LIVE_CAPTIONS','MEETING_NOTES','MESSAGE_REWRITE')
  ),
  privacy_mode TEXT NOT NULL CHECK (
    privacy_mode IN ('ON_DEVICE','CONFIDENTIAL_CLOUD','DISABLED')
  ),
  input_ciphertext BYTEA,
  output_ciphertext BYTEA,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('PRIVATE','INVITE_ONLY','PUBLIC')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED','DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('OWNER','ADMIN','SECURITY_ADMIN','COMPLIANCE_ADMIN','MEMBER')
  ),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,user_id)
);

CREATE TABLE enterprise_identity_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('OIDC','SAML')),
  issuer TEXT NOT NULL,
  metadata_ciphertext BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enterprise_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_key TEXT NOT NULL,
  policy_value JSONB NOT NULL,
  enforced BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,policy_key)
);

CREATE TABLE legal_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED')),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE TABLE verified_identity_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL,
  issuer TEXT NOT NULL,
  credential_hash BYTEA NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID','REVOKED','EXPIRED')),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE secure_bridges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id UUID NOT NULL REFERENCES organizations(id),
  target_organization_id UUID NOT NULL REFERENCES organizations(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  policy_ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_organization_id,target_organization_id)
);

COMMIT;
