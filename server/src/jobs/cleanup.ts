import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const result = await db.query(`
    WITH deleted_country_quotas AS (
      DELETE FROM countrylinqa_rate_buckets WHERE expires_at < now() RETURNING 1
    ), deleted_envelopes AS (
      DELETE FROM message_envelopes
      WHERE expires_at < now()
         OR acknowledged_at < now() - interval '7 days'
      RETURNING 1
    ),
    deleted_challenges AS (
      DELETE FROM device_registration_challenges
      WHERE expires_at < now() - interval '1 day'
         OR consumed_at < now() - interval '1 day'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM deleted_country_quotas) AS country_quotas_deleted,
      (SELECT count(*) FROM deleted_envelopes) AS envelopes_deleted,
      (SELECT count(*) FROM deleted_challenges) AS challenges_deleted
  `);

  console.log(result.rows[0]);
} finally {
  await db.end();
}
