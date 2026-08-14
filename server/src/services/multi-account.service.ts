import { randomBytes } from "node:crypto";
import type { Database } from "../db/pool.js";
import type { AccountLimitService } from "./account-limit.service.js";

export class MultiAccountService {
  constructor(
    private readonly db: Database,
    private readonly limits: AccountLimitService
  ) {}

  /**
   * Not part of the source pack (2026-08-07 apply pass addition): nothing
   * in the pack ever creates a device_installations_v2 row, so every other
   * multi-account endpoint (which all take an existing installationId) was
   * unreachable from a fresh install with no way to obtain one. The mobile
   * client generates and persists a random installation_public_id once
   * (see account/InstallationIdentity.ts) and calls this to get back the
   * server-side installation row id.
   */
  async registerInstallation(input: { installationPublicId: string; platform: "IOS" | "ANDROID" | "WEB" | "WINDOWS" | "MACOS" | "LINUX" }) {
    const result = await this.db.query(
      `INSERT INTO device_installations_v2(installation_public_id,platform)
       VALUES($1,$2)
       ON CONFLICT(installation_public_id)
       DO UPDATE SET last_seen_at=now()
       RETURNING id,trust_state`,
      [input.installationPublicId, input.platform]
    );

    return result.rows[0];
  }

  async list(installationId: string) {
    // FIX (2026-08-07 apply pass): the pack joined a nonexistent
    // app_profiles table. The real profile table (009_gap_closure.sql) is
    // `user_profiles`.
    const result = await this.db.query(
      `SELECT
         ia.user_id,
         ia.account_slot,
         ia.label,
         ia.state,
         p.display_name,
         p.avatar_object_key,
         ph.national_number_suffix,
         ph.country_iso2,
         ph.verification_state
       FROM installation_accounts_v2 ia
       LEFT JOIN user_profiles p ON p.user_id=ia.user_id
       LEFT JOIN phone_identities_v2 ph ON ph.user_id=ia.user_id
       WHERE ia.installation_id=$1
         AND ia.state='ACTIVE'
       ORDER BY ia.account_slot`,
      [installationId]
    );

    return result.rows;
  }

  async add(input: { installationId: string; userId: string; label?: string }) {
    await this.limits.requireCapacity(input.installationId);

    const phone = await this.db.query(
      `SELECT verification_state
       FROM phone_identities_v2
       WHERE user_id=$1`,
      [input.userId]
    );

    if (phone.rows[0]?.verification_state !== "VERIFIED_MOBILE") {
      throw new Error("verified_mobile_number_required");
    }

    const slot = await this.limits.nextAvailableSlot(input.installationId);

    const keyAlias = `linqa.account.${input.userId}.${randomBytes(8).toString("hex")}`;

    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO installation_accounts_v2(
           installation_id,user_id,account_slot,label,state
         ) VALUES($1,$2,$3,$4,'ACTIVE')
         ON CONFLICT(installation_id,user_id)
         DO UPDATE SET
           state='ACTIVE',
           removed_at=NULL,
           account_slot=EXCLUDED.account_slot,
           label=EXCLUDED.label`,
        [input.installationId, input.userId, slot, input.label ?? null]
      );

      await client.query(
        `INSERT INTO account_storage_namespaces_v2(
           installation_id,user_id,key_alias
         ) VALUES($1,$2,$3)
         ON CONFLICT(installation_id,user_id)
         DO NOTHING`,
        [input.installationId, input.userId, keyAlias]
      );

      await client.query(
        `INSERT INTO account_limit_events_v2(
           installation_id,attempted_user_id,event_type,metadata
         ) VALUES($1,$2,'ACCOUNT_ADDED',$3)`,
        [input.installationId, input.userId, { slot }]
      );

      await client.query("COMMIT");

      return {
        userId: input.userId,
        accountSlot: slot
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async remove(input: { installationId: string; userId: string }) {
    const result = await this.db.query(
      `UPDATE installation_accounts_v2
       SET state='REMOVED',removed_at=now()
       WHERE installation_id=$1
         AND user_id=$2
         AND state='ACTIVE'`,
      [input.installationId, input.userId]
    );

    if (result.rowCount !== 1) {
      throw new Error("account_membership_not_found");
    }

    await this.db.query(
      `UPDATE account_push_bindings_v2
       SET active=FALSE,updated_at=now()
       WHERE installation_id=$1 AND user_id=$2`,
      [input.installationId, input.userId]
    );
  }
}
