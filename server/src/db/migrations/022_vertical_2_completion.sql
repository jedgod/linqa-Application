BEGIN;

CREATE TABLE IF NOT EXISTS contact_invites_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED','BLOCKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CHECK (sender_user_id <> recipient_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_invites_v2_pending_unique
  ON contact_invites_v2(sender_user_id,recipient_user_id) WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS calendar_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_ciphertext BYTEA NOT NULL,
  description_ciphertext BYTEA,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS calendar_event_attendees_v2 (
  event_id UUID NOT NULL REFERENCES calendar_events_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL DEFAULT 'PENDING' CHECK (response IN ('PENDING','ACCEPTED','DECLINED','TENTATIVE')),
  PRIMARY KEY(event_id,user_id)
);

CREATE TABLE IF NOT EXISTS secure_notes_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL CHECK (note_type IN ('NOTE','CHECKLIST','DRAWING','VOICE')),
  ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collaborative_note_members_v2 (
  note_id UUID NOT NULL REFERENCES secure_notes_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('VIEW','EDIT')),
  PRIMARY KEY(note_id,user_id)
);

CREATE TABLE IF NOT EXISTS screen_share_sessions_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  presenter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  presenter_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  share_type TEXT NOT NULL CHECK (share_type IN ('SCREEN','WINDOW','APPLICATION','WHITEBOARD')),
  status TEXT NOT NULL DEFAULT 'PENDING_CONSENT' CHECK (status IN ('PENDING_CONSENT','ACTIVE','PAUSED','ENDED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS screen_share_consents_v2 (
  session_id UUID NOT NULL REFERENCES screen_share_sessions_v2(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consented BOOLEAN NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,user_id)
);

CREATE TABLE IF NOT EXISTS wallet_items_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('CARD','IDENTITY','PASS','LOYALTY','MEMBERSHIP','PAYMENT_REFERENCE')),
  data_ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_events_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE emergency_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'SOS'
    CHECK (event_type IN ('SOS','SILENT_ALERT','LIVE_LOCATION','EMERGENCY_VIDEO')),
  ADD COLUMN IF NOT EXISTS encrypted_payload BYTEA;

COMMIT;