import type { Database } from "../db/pool.js";

const DUE_DAYS: Record<string, number> = {
  GDPR: 30,
  CCPA: 45,
  CPRA: 45
};

export class PrivacyRightsService {
  constructor(private readonly db: Database) {}

  async create(input: {
    userId: string;
    deviceId?: string;
    type: "ACCESS" | "PORTABILITY" | "DELETE" | "CORRECT" | "OPT_OUT_SALE" | "OPT_OUT_SHARING" | "LIMIT_SENSITIVE_USE";
    jurisdiction: string;
  }) {
    const days = DUE_DAYS[input.jurisdiction.toUpperCase()] ?? 30;

    const result = await this.db.query(
      `INSERT INTO privacy_requests_v2(
         user_id,request_type,jurisdiction,state,due_at,
         requested_from_device_id
       ) VALUES($1,$2,$3,'IDENTITY_VERIFICATION',
         now()+($4 || ' days')::interval,$5
       )
       RETURNING id,state,due_at,created_at`,
      [input.userId, input.type, input.jurisdiction, days, input.deviceId ?? null]
    );

    return result.rows[0];
  }

  async markVerified(requestId: string, userId: string) {
    const result = await this.db.query(
      `UPDATE privacy_requests_v2
       SET state='VERIFIED'
       WHERE id=$1
         AND user_id=$2
         AND state='IDENTITY_VERIFICATION'`,
      [requestId, userId]
    );

    if (result.rowCount !== 1) {
      throw new Error("privacy request cannot be verified");
    }
  }

  async enqueueProcessing(requestId: string, userId: string) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const request = await client.query(
        `UPDATE privacy_requests_v2
         SET state='PROCESSING'
         WHERE id=$1 AND user_id=$2 AND state='VERIFIED'
         RETURNING request_type`,
        [requestId, userId]
      );

      if (request.rowCount !== 1) {
        throw new Error("verified privacy request not found");
      }

      const steps = [
        "PROFILE",
        "DEVICE_SESSIONS",
        "CONTACTS",
        "MESSAGING_METADATA",
        "CALL_METADATA",
        "VAULT_METADATA",
        "NOTES_CALENDAR",
        "WALLET_METADATA",
        "BILLING_METADATA",
        "ENTERPRISE_METADATA",
        "SECURITY_AUDIT"
      ];

      for (const step of steps) {
        await client.query(
          `INSERT INTO privacy_request_steps_v2(
             request_id,step_key,state
           ) VALUES($1,$2,'PENDING')
           ON CONFLICT DO NOTHING`,
          [requestId, step]
        );
      }

      await client.query("COMMIT");
      return { queued: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
