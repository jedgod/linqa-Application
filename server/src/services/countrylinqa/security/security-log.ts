import type { Database } from "../../../db/pool.js";
import { sha256Hex } from "./crypto.js";

export async function securityLog(
  db: Database,
  input: {
    userId?: string | null;
    actorUserId?: string | null;
    eventType: string;
    severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    ip?: string | null;
    deviceId?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO countrylinqa_security_events
       (user_id, actor_user_id, event_type, severity, ip_hash, device_hash, session_id_hash, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.userId ?? null,
      input.actorUserId ?? null,
      input.eventType,
      input.severity,
      input.ip ? sha256Hex(input.ip) : null,
      input.deviceId ? sha256Hex(input.deviceId) : null,
      input.sessionId ? sha256Hex(input.sessionId) : null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}
