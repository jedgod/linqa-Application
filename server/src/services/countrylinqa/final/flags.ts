import type { Database } from "../../../db/pool.js";
import type { Cache } from "./cache.js";

export class CountryLinqaFlags {
  constructor(private readonly db: Database, private readonly cache: Cache) {}

  async enabled(key: string): Promise<boolean> {
    const cacheKey = `countrylinqa:flag:${key}`;
    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    const result = await this.db.query(`SELECT enabled FROM countrylinqa_feature_flags WHERE key = $1`, [key]);
    const value = Boolean(result.rows[0]?.enabled);
    await this.cache.set(cacheKey, value, 60);
    return value;
  }
}
