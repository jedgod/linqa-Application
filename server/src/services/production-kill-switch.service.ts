import type { Database } from "../db/pool.js";

/**
 * Renamed from Milestone 4's `KillSwitchService` (2026-08-07 apply pass):
 * that name and table (`production_kill_switches_v2`) are distinct from
 * the existing `KillSwitchService` in kill-switch.service.ts (table
 * `operational_kill_switches`, method `assertEnabledOperation`, already
 * wired in as `services.killSwitches` and used by attachment routes).
 * Reusing the name would have silently replaced that working feature.
 * This is the GA-wide production kill switch set (messaging, calls,
 * uploads, AI, billing, enterprise provisioning, emergency video,
 * signups); the existing one guards a narrower set of operational
 * fail-safes. Both coexist.
 */
export class ProductionKillSwitchService {
  constructor(private readonly db: Database) {}

  /** Not part of the source pack — added so the switches can be listed/read, not just blindly set. */
  async list() {
    const result = await this.db.query(
      `SELECT key,description,enabled,last_changed_by,last_changed_reason,updated_at
       FROM production_kill_switches_v2
       ORDER BY key`
    );
    return result.rows;
  }

  async requireEnabledFeature(switchKey: string) {
    const result = await this.db.query(
      `SELECT enabled,last_changed_reason
       FROM production_kill_switches_v2
       WHERE key=$1`,
      [switchKey]
    );

    const row = result.rows[0];

    if (row?.enabled === true) {
      throw new Error(row.last_changed_reason ?? `feature disabled by production kill switch: ${switchKey}`);
    }
  }

  async set(input: { key: string; enabled: boolean; actor: string; reason: string }) {
    const result = await this.db.query(
      `UPDATE production_kill_switches_v2
       SET enabled=$2,
           last_changed_by=$3,
           last_changed_reason=$4,
           updated_at=now()
       WHERE key=$1
       RETURNING key,enabled,updated_at`,
      [input.key, input.enabled, input.actor, input.reason]
    );

    if (result.rowCount !== 1) {
      throw new Error("kill switch not found");
    }

    return result.rows[0];
  }
}
