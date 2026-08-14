import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const result = await db.query(`
    WITH expired AS (
      DELETE FROM message_envelopes
      WHERE expires_at < now()
         OR acknowledged_at < now() - interval '7 days'
      RETURNING 1
    ),
    old_audit AS (
      DELETE FROM audit_events
      WHERE created_at < now() - interval '90 days'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM expired) AS envelopes_deleted,
      (SELECT count(*) FROM old_audit) AS audit_events_deleted
  `);

  console.log(result.rows[0]);
} finally {
  await db.end();
}
