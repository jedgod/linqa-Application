import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const result = await db.query(`
    WITH invalidated AS (
      UPDATE push_endpoints
      SET status = 'INVALID',
          updated_at = now()
      WHERE status = 'ACTIVE'
        AND failure_count >= 5
      RETURNING 1
    ),
    deleted_events AS (
      DELETE FROM push_delivery_events
      WHERE created_at < now() - interval '30 days'
      RETURNING 1
    ),
    expired_signaling AS (
      DELETE FROM signaling_events
      WHERE expires_at < now()
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM invalidated) AS invalidated_endpoints,
      (SELECT count(*) FROM deleted_events) AS deleted_push_events,
      (SELECT count(*) FROM expired_signaling) AS deleted_signaling_events
  `);

  console.log(result.rows[0]);
} finally {
  await db.end();
}
