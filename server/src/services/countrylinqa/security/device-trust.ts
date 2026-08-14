import type { Database } from "../../../db/pool.js";
import { sha256Hex } from "./crypto.js";
import { securityLog } from "./security-log.js";

export async function registerDeviceObservation(
  db: Database,
  userId: string,
  rawDeviceId: string,
  metadata: Record<string, unknown> = {}
): Promise<string> {
  const deviceIdHash = sha256Hex(rawDeviceId);

  const existing = await db.query(
    `SELECT trust_state FROM countrylinqa_device_trust WHERE user_id = $1 AND device_id_hash = $2`,
    [userId, deviceIdHash]
  );

  if ((existing.rowCount ?? 0) === 0) {
    await db.query(
      `INSERT INTO countrylinqa_device_trust (user_id, device_id_hash, trust_state, metadata)
       VALUES ($1,$2,'UNKNOWN',$3)`,
      [userId, deviceIdHash, JSON.stringify(metadata)]
    );
    await securityLog(db, {
      userId,
      eventType: "NEW_DEVICE_OBSERVED",
      severity: "LOW",
      deviceId: rawDeviceId
    });
    return "UNKNOWN";
  }

  await db.query(
    `UPDATE countrylinqa_device_trust SET last_seen_at = now(), metadata = metadata || $3::jsonb
     WHERE user_id = $1 AND device_id_hash = $2`,
    [userId, deviceIdHash, JSON.stringify(metadata)]
  );
  return existing.rows[0].trust_state;
}
