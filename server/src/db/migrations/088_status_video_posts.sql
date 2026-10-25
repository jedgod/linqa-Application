BEGIN;

-- Video posts to a person's status (Live Video Podcast recordings and other short videos), end-to-end encrypted.
--
-- The server stores only what it needs to deliver and expire a post:
--   * the encrypted video, held in object storage as a completed attachment upload (ciphertext only);
--   * who may fetch it, and one opaque sealed key bundle per recipient DEVICE.
-- The key, nonce prefix, MIME type, caption and chunk layout live inside each sealed bundle, which only that device can open.
-- Nothing in these tables can decrypt the video, and there is deliberately no column that could hold a key.
CREATE TABLE IF NOT EXISTS status_video_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A revoked/removed device must not erase the post, so this is nulled rather than cascaded.
  owner_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  attachment_id UUID NOT NULL UNIQUE REFERENCES attachment_uploads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'VIDEO' CHECK (kind IN ('VIDEO', 'PODCAST')),
  -- Capped at 30 minutes. Longer sessions are not offered; any pricing for extra minutes is a product decision not made here.
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 1800),
  ciphertext_size BIGINT NOT NULL CHECK (ciphertext_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- Soft delete keeps an audit trail (who posted what, to how many, and when it was removed) after the video itself is gone.
  deleted_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '7 days')
);

CREATE INDEX IF NOT EXISTS status_video_posts_owner_idx
  ON status_video_posts (owner_user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS status_video_posts_expiry_idx
  ON status_video_posts (expires_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS status_video_recipients (
  post_id UUID NOT NULL REFERENCES status_video_posts(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Bound to a device: only that device's keys can open its bundle, and revoking the device ends its access.
  recipient_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  -- Opaque ciphertext produced on the owner's phone. Bounded so it cannot be used to park arbitrary data.
  sealed_key TEXT NOT NULL CHECK (char_length(sealed_key) BETWEEN 1 AND 65536),
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, recipient_device_id)
);

CREATE INDEX IF NOT EXISTS status_video_recipients_device_idx
  ON status_video_recipients (recipient_device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS status_video_recipients_user_idx
  ON status_video_recipients (recipient_user_id);

COMMIT;
