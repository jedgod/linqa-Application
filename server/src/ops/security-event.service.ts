import type { Database } from "../db/pool.js";

export class SecurityEventService {
  constructor(private readonly db: Database) {}

  async record(input: {
    userId?: string;
    deviceId?: string;
    eventType: string;
    targetType?: string;
    targetId?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.query(
      `INSERT INTO audit_events (
         actor_user_id,
         actor_device_id,
         event_type,
         target_type,
         target_id,
         request_id,
         metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.userId ?? null,
        input.deviceId ?? null,
        input.eventType,
        input.targetType ?? null,
        input.targetId ?? null,
        input.requestId ?? null,
        input.metadata ?? {}
      ]
    );
  }

  async notifyUser(input: {
    userId: string;
    type: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.query(
      `INSERT INTO security_notifications (
         user_id, type, title, message, metadata
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
        input.userId,
        input.type,
        input.title,
        input.message,
        input.metadata ?? {}
      ]
    );
  }
}
