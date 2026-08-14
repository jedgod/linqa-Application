import { createHmac } from "node:crypto";
import type { Database } from "../db/pool.js";

export class TurnRegionService {
  constructor(
    private readonly db: Database,
    private readonly secret: string
  ) {}

  async selectRegion() {
    const result = await this.db.query(
      `SELECT region_code,endpoint,priority,capacity_score
       FROM turn_regions_v2
       WHERE healthy=TRUE
       ORDER BY priority ASC,capacity_score DESC
       LIMIT 1`
    );

    const region = result.rows[0];
    if (!region) throw new Error("no healthy TURN region");

    return region;
  }

  async issueCredentials(userId: string, ttlSeconds = 3600) {
    const region = await this.selectRegion();
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expires}:${userId}`;

    const password = createHmac("sha1", this.secret).update(username).digest("base64");

    return {
      region: region.region_code,
      urls: [
        `turn:${region.endpoint}?transport=udp`,
        `turn:${region.endpoint}?transport=tcp`,
        `turns:${region.endpoint}?transport=tcp`
      ],
      username,
      credential: password,
      expiresAt: expires
    };
  }
}
