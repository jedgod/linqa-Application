import type { Database } from "../../../db/pool.js";
import type { SubscriptionTier } from "../entitlements.js";
import { auditCountryLinqa } from "./audit.js";

export async function reconcileCountryLinqaSubscription(
  db: Database,
  userId: string,
  newTier: SubscriptionTier,
  source: string,
  expiresAt?: Date | null
): Promise<{ tier: SubscriptionTier; mode: string; action: string }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT
         COALESCE(s.tier, 'FREE') AS tier,
         COALESCE(p.mode, 'MY_COUNTRY') AS mode,
         (SELECT count(*)::int FROM country_links WHERE user_id = u.id) AS country_count,
         (SELECT count(*)::int FROM regional_links WHERE user_id = u.id) AS region_count
       FROM users u
       LEFT JOIN countrylinqa_subscription_snapshots s ON s.user_id = u.id
       LEFT JOIN country_discovery_preferences p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const row = current.rows[0];
    if (!row) {
      const error: any = new Error("User not found");
      error.status = 404;
      throw error;
    }

    let action = "NO_CHANGE";
    let newMode = row.mode;

    if (newTier === "FREE" && row.mode !== "MY_COUNTRY") {
      action = "DOWNGRADE_TO_MY_COUNTRY";
      newMode = "MY_COUNTRY";
      await client.query(`DELETE FROM country_links WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM regional_links WHERE user_id = $1`, [userId]);
      await client.query(
        `INSERT INTO country_discovery_preferences (user_id, mode) VALUES ($1, 'MY_COUNTRY')
         ON CONFLICT (user_id) DO UPDATE SET mode = 'MY_COUNTRY', updated_at = now()`,
        [userId]
      );
    } else if (newTier === "PREMIUM" && row.mode === "GLOBAL") {
      action = "GLOBAL_REMOVED_ON_DOWNGRADE";
      newMode = "MY_COUNTRY";
      await client.query(
        `UPDATE country_discovery_preferences SET mode = 'MY_COUNTRY', updated_at = now() WHERE user_id = $1`,
        [userId]
      );
    }

    await client.query(
      `INSERT INTO countrylinqa_subscription_snapshots (user_id, tier, source, expires_at, last_synced_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, source = EXCLUDED.source,
         expires_at = EXCLUDED.expires_at, last_synced_at = now()`,
      [userId, newTier, source, expiresAt ?? null]
    );

    await client.query(
      `INSERT INTO countrylinqa_preference_reconciliation
         (user_id, previous_tier, new_tier, previous_mode, new_mode, action, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        userId,
        row.tier,
        newTier,
        row.mode,
        newMode,
        action,
        JSON.stringify({ previousCountryCount: row.country_count, previousRegionCount: row.region_count })
      ]
    );

    await client.query("COMMIT");
    await auditCountryLinqa(db, {
      userId,
      eventType: "SUBSCRIPTION_RECONCILED",
      oldValue: { tier: row.tier, mode: row.mode },
      newValue: { tier: newTier, mode: newMode },
      metadata: { action, source }
    });

    return { tier: newTier, mode: newMode, action };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
