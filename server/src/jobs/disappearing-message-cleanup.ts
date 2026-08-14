import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const result = await db.query(`
    WITH deleted_messages AS (
      DELETE FROM message_envelopes m
      WHERE m.expires_at < now()
        AND NOT EXISTS (
          SELECT 1
          FROM retention_overrides o
          WHERE o.resource_type = 'MESSAGE'
            AND o.resource_id = m.id
            AND o.released_at IS NULL
            AND (o.expires_at IS NULL OR o.expires_at > now())
        )
      RETURNING id
    ),
    queued_voice AS (
      UPDATE encrypted_voice_notes v
      SET deletion_status = 'QUEUED'
      WHERE v.deletion_status = 'ACTIVE'
        AND v.expires_at IS NOT NULL
        AND v.expires_at < now()
        AND NOT EXISTS (
          SELECT 1
          FROM retention_overrides o
          WHERE o.resource_type = 'VOICE_NOTE'
            AND o.resource_id = v.id
            AND o.released_at IS NULL
        )
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM deleted_messages) AS deleted_messages,
      (SELECT count(*) FROM queued_voice) AS queued_voice_notes
  `);

  console.log(result.rows[0]);
} finally {
  await db.end();
}
