/**
 * Development only: a device-bound session for an existing account and device, to act as that phone in a script or test
 * (for example approving a QR link without holding the phone).
 *
 *   node --env-file=.env --import tsx src/dev/mint-device-token.ts <userId> <deviceId>
 *
 * Refuses to run when NODE_ENV is production.
 */
import pg from "pg";
import { loadConfig } from "../config.js";
import { SessionService } from "../services/session.service.js";
import { ENROLLED_DEVICE_SCOPES } from "../routes/enrollment.js";
import { PRE_ENROLLMENT_SCOPES } from "../routes/auth.js";
import type { Database } from "../db/pool.js";

const config = loadConfig();
if (config.NODE_ENV === "production") throw new Error("This helper is for development only.");
const [userId, deviceId] = process.argv.slice(2);
if (!userId || !deviceId) throw new Error("Usage: mint-device-token.ts <userId> <deviceId>");

const db = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
try {
  const found = await db.query(
    `SELECT u.external_subject FROM users u JOIN devices d ON d.user_id = u.id WHERE u.id = $1 AND d.id = $2 AND d.status = 'ACTIVE'`,
    [userId, deviceId]
  );
  if (found.rowCount !== 1) throw new Error("No active device with that id for that user.");
  const sessions = new SessionService(db as unknown as Database, config);
  const session = await sessions.create({
    userId,
    subject: found.rows[0].external_subject as string,
    deviceId,
    scopes: Array.from(new Set([...PRE_ENROLLMENT_SCOPES, ...ENROLLED_DEVICE_SCOPES]))
  });
  console.log(session.accessToken);
} finally {
  await db.end();
}
