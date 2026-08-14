import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const result = await db.query(`
    WITH expired_attachments AS (
      UPDATE attachment_uploads
      SET status = 'EXPIRED'
      WHERE expires_at < now()
        AND status IN ('CREATED', 'UPLOADING')
      RETURNING 1
    ),
    deleted_sync AS (
      DELETE FROM sync_records
      WHERE expires_at IS NOT NULL
        AND expires_at < now()
      RETURNING 1
    ),
    deleted_messages AS (
      DELETE FROM message_envelopes
      WHERE acknowledged_at < now() - interval '7 days'
         OR expires_at < now()
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM expired_attachments) AS expired_attachments,
      (SELECT count(*) FROM deleted_sync) AS deleted_sync_records,
      (SELECT count(*) FROM deleted_messages) AS deleted_message_envelopes
  `);

  console.log(result.rows[0]);
} finally {
  await db.end();
}
