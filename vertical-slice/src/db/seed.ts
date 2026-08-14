import { randomBytes } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

const config = loadConfig();
const db = createPool(config);

try {
  const alice = await db.query(
    `INSERT INTO users (external_subject, display_name)
     VALUES ('demo-alice', 'Alice')
     ON CONFLICT (external_subject)
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`
  );

  const bob = await db.query(
    `INSERT INTO users (external_subject, display_name)
     VALUES ('demo-bob', 'Bob')
     ON CONFLICT (external_subject)
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`
  );

  const aliceDevice = await db.query(
    `INSERT INTO devices (
       user_id, device_name, platform, signing_public_key, encryption_public_key
     ) VALUES ($1, 'Alice Web', 'WEB', $2, $3)
     ON CONFLICT (user_id, signing_public_key)
     DO UPDATE SET status = 'ACTIVE'
     RETURNING id`,
    [alice.rows[0].id, randomBytes(32), randomBytes(32)]
  );

  const bobDevice = await db.query(
    `INSERT INTO devices (
       user_id, device_name, platform, signing_public_key, encryption_public_key
     ) VALUES ($1, 'Bob Web', 'WEB', $2, $3)
     ON CONFLICT (user_id, signing_public_key)
     DO UPDATE SET status = 'ACTIVE'
     RETURNING id`,
    [bob.rows[0].id, randomBytes(32), randomBytes(32)]
  );

  console.log({
    aliceUserId: alice.rows[0].id,
    aliceDeviceId: aliceDevice.rows[0].id,
    bobUserId: bob.rows[0].id,
    bobDeviceId: bobDevice.rows[0].id
  });
} finally {
  await db.end();
}
