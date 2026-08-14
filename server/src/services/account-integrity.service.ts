import type { Database } from "../db/pool.js";

export class AccountIntegrityService {
  constructor(private readonly db: Database) {}

  async evaluateDevice(deviceId: string): Promise<{
    score: number;
    action: "ALLOW" | "CHALLENGE" | "RESTRICT" | "REVIEW";
  }> {
    const result = await this.db.query(
      `SELECT score, registration_failures, spam_events, reports_received
       FROM device_reputation
       WHERE device_id = $1`,
      [deviceId]
    );

    const row = result.rows[0] ?? {
      score: 50,
      registration_failures: 0,
      spam_events: 0,
      reports_received: 0
    };

    let score = Number(row.score);
    score -= Math.min(20, Number(row.registration_failures) * 2);
    score -= Math.min(30, Number(row.spam_events) * 5);
    score -= Math.min(30, Number(row.reports_received) * 3);
    score = Math.max(0, Math.min(100, score));

    const action =
      score >= 60 ? "ALLOW" :
      score >= 40 ? "CHALLENGE" :
      score >= 20 ? "RESTRICT" :
      "REVIEW";

    return { score, action };
  }
}
