import type { Database } from "../db/pool.js";
import { createHmac } from "node:crypto";

export class ContactDiscoveryService {
  constructor(
    private readonly db: Database,
    private readonly lookupSecret: string
  ) {}

  token(identifierType: "PHONE" | "EMAIL", normalizedValue: string): Buffer {
    return createHmac("sha256", this.lookupSecret)
      .update(`linqa:contact-discovery:v1:${identifierType}:${normalizedValue}`)
      .digest();
  }

  async publishIdentifiers(input: {
    userId: string;
    identifiers: Array<{
      type: "PHONE" | "EMAIL";
      normalizedValue: string;
      discoverable: boolean;
    }>;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM contact_discovery_identifiers WHERE user_id = $1`,
        [input.userId]
      );

      for (const identifier of input.identifiers) {
        await client.query(
          `INSERT INTO contact_discovery_identifiers (
             user_id, identifier_type, lookup_token, discoverable
           ) VALUES ($1,$2,$3,$4)`,
          [
            input.userId,
            identifier.type,
            this.token(identifier.type, identifier.normalizedValue),
            identifier.discoverable
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async discover(input: {
    userId: string;
    deviceId: string;
    tokens: Array<{ type: "PHONE" | "EMAIL"; token: Buffer }>;
  }) {
    if (input.tokens.length === 0 || input.tokens.length > 500) {
      throw new Error("invalid discovery batch size");
    }

    const values: Buffer[] = input.tokens.map((item) => item.token);
    const result = await this.db.query(
      `SELECT DISTINCT user_id
       FROM contact_discovery_identifiers
       WHERE discoverable = TRUE
         AND lookup_token = ANY($1::bytea[])
         AND user_id <> $2
       LIMIT 500`,
      [values, input.userId]
    );

    await this.db.query(
      `INSERT INTO contact_discovery_queries (
         user_id, device_id, item_count, result_count
       ) VALUES ($1,$2,$3,$4)`,
      [input.userId, input.deviceId, input.tokens.length, result.rowCount ?? 0]
    );

    return result.rows.map((row) => row.user_id as string);
  }
}
