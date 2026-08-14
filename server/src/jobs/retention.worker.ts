import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const result = await db.query(`
    WITH expired_locations AS (
      DELETE FROM encrypted_location_events
      WHERE expires_at < now()
      RETURNING 1
    ),
    expired_grants AS (
      UPDATE call_location_grants
      SET status = 'EXPIRED'
      WHERE status = 'ACTIVE'
        AND expires_at < now()
      RETURNING 1
    ),
    queued_recordings AS (
      UPDATE recorded_video_assets r
      SET deletion_status = 'QUEUED'
      WHERE deletion_status = 'ACTIVE'
        AND (
          (expires_at IS NOT NULL AND expires_at < now())
          OR (
            retention_policy IN ('VIEW_ONCE','DELETE_AFTER_VIEW')
            AND viewed_at IS NOT NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM retention_overrides o
          WHERE o.resource_type = 'RECORDED_VIDEO'
            AND o.resource_id = r.id
            AND o.released_at IS NULL
            AND (o.expires_at IS NULL OR o.expires_at > now())
        )
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM expired_locations) AS deleted_location_events,
      (SELECT count(*) FROM expired_grants) AS expired_location_grants,
      (SELECT count(*) FROM queued_recordings) AS queued_recordings
  `);

  console.log(result.rows[0]);
} finally {
  await db.end();
}
