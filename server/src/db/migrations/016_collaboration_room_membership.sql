-- collaboration_rooms and collaboration_subscriptions were created in
-- 007_three_milestones.sql / 008_execution_launch.sql but nothing ever
-- populated or checked them: CollaborationService.append() inserted into
-- collaboration_events for any caller-supplied room_id with no membership
-- check at all. This closes that gap by making collaboration_subscriptions
-- a real membership table (user_id + soft-removal), mirroring the
-- user_id/device_id/removed marker shape already used by group_memberships.

ALTER TABLE collaboration_subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS collaboration_subscriptions_active_idx
  ON collaboration_subscriptions(room_id, user_id)
  WHERE removed_at IS NULL;
