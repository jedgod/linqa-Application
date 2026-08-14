import type { Database } from "../../db/pool.js";
import { normalizeIdentifier } from "../../auth/normalize.js";

export interface ResolvedLinqaUser {
  userId: string;
  displayName: string;
}

/**
 * Real lookup against `account_identifiers` (verified phone/email only —
 * unverified identifiers never resolve a payable recipient), reusing the
 * same normalization the auth challenge flow uses so "+1 (202) 555-0123"
 * and "12025550123" resolve identically. The pack's own version was a stub
 * returning null; this is the real repository-backed implementation it
 * asked for.
 */
export class RecipientResolverService {
  constructor(private readonly db: Database) {}

  async resolveLinqaUser(query: string): Promise<ResolvedLinqaUser | null> {
    let identifier: ReturnType<typeof normalizeIdentifier>;
    try {
      identifier = normalizeIdentifier(query);
    } catch {
      return null;
    }

    const { rows } = await this.db.query(
      `SELECT u.id, ai.display_value
       FROM account_identifiers ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.type = $1 AND ai.normalized_value = $2
         AND ai.verified_at IS NOT NULL AND ai.disabled_at IS NULL
         AND u.status = 'ACTIVE'
       LIMIT 1`,
      [identifier.type, identifier.normalized]
    );

    const row = rows[0];
    if (!row) return null;
    return { userId: row.id as string, displayName: row.display_value as string };
  }
}
