import type { Database } from "../db/pool.js";

function normalizeUsername(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.]{2,29}$/.test(normalized)) {
    throw new Error("invalid username");
  }
  return normalized;
}

export class UsernameService {
  constructor(private readonly db: Database) {}

  async change(userId: string, requested: string) {
    const normalized = normalizeUsername(requested);
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const current = await client.query(
        `SELECT normalized_username, next_change_allowed_at
         FROM usernames
         WHERE user_id = $1
         FOR UPDATE`,
        [userId]
      );

      if (
        current.rows[0] &&
        new Date(current.rows[0].next_change_allowed_at).getTime() > Date.now()
      ) {
        throw new Error("username change cooldown active");
      }

      const history = await client.query(
        `SELECT 1
         FROM username_history
         WHERE normalized_username = $1
           AND reusable_after > now()`,
        [normalized]
      );
      if (history.rowCount) throw new Error("username temporarily unavailable");

      if (current.rows[0]) {
        await client.query(
          `INSERT INTO username_history (
             user_id, normalized_username, released_at, reusable_after
           ) VALUES ($1,$2,now(),now() + interval '90 days')`,
          [userId, current.rows[0].normalized_username]
        );
      }

      await client.query(
        `INSERT INTO usernames (
           user_id, normalized_username, display_username,
           changed_at, next_change_allowed_at
         ) VALUES ($1,$2,$3,now(),now() + interval '30 days')
         ON CONFLICT (user_id)
         DO UPDATE SET
           normalized_username = EXCLUDED.normalized_username,
           display_username = EXCLUDED.display_username,
           changed_at = now(),
           next_change_allowed_at = now() + interval '30 days'`,
        [userId, normalized, requested.trim()]
      );

      await client.query("COMMIT");
      return { username: normalized };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
