BEGIN;

CREATE TABLE attachment_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  ciphertext_size BIGINT NOT NULL CHECK (ciphertext_size > 0),
  chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
  manifest_hash BYTEA NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('CREATED', 'UPLOADING', 'COMPLETE', 'EXPIRED', 'DELETED')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX attachment_uploads_expiry_idx
  ON attachment_uploads(expires_at)
  WHERE status NOT IN ('DELETED', 'EXPIRED');

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ciphertext BYTEA NOT NULL,
  current_epoch BIGINT NOT NULL DEFAULT 0,
  current_state_hash BYTEA,
  created_by_device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE group_memberships (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  joined_epoch BIGINT NOT NULL,
  removed_epoch BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, device_id)
);

CREATE INDEX group_memberships_active_idx
  ON group_memberships(group_id, user_id)
  WHERE removed_epoch IS NULL;

CREATE TABLE group_state_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL,
  state_ciphertext BYTEA NOT NULL,
  state_hash BYTEA NOT NULL,
  previous_state_hash BYTEA,
  signer_device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, epoch),
  UNIQUE(group_id, state_hash)
);

CREATE TABLE sync_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  target_device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (
    record_type IN (
      'MESSAGE',
      'RECEIPT',
      'CONTACT',
      'SETTINGS',
      'GROUP_STATE',
      'TOMBSTONE',
      'BACKUP_POINTER'
    )
  ),
  client_record_id UUID NOT NULL,
  ciphertext BYTEA NOT NULL,
  logical_clock BIGINT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_device_id, client_record_id)
);

CREATE INDEX sync_records_target_idx
  ON sync_records(user_id, target_device_id, logical_clock);

CREATE TABLE encrypted_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_device_id UUID NOT NULL REFERENCES devices(id),
  object_key TEXT NOT NULL UNIQUE,
  archive_version INTEGER NOT NULL,
  manifest_hash BYTEA NOT NULL,
  ciphertext_size BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('CREATED', 'UPLOADING', 'COMPLETE', 'RESTORING', 'DELETED', 'CORRUPT')
  ),
  retention_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE operational_kill_switches (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO operational_kill_switches(key, enabled, reason, changed_by)
VALUES
  ('message_send_disabled', FALSE, NULL, 'migration'),
  ('attachment_upload_disabled', FALSE, NULL, 'migration'),
  ('new_device_enrollment_disabled', FALSE, NULL, 'migration'),
  ('backup_restore_disabled', FALSE, NULL, 'migration');

CREATE TABLE privacy_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_bucket TEXT NOT NULL,
  count_value BIGINT NOT NULL CHECK (count_value >= 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(metric_name, metric_bucket, recorded_at)
);

COMMIT;
