import type { Database } from "../db/pool.js";

export class CommunityService {
  constructor(private readonly db: Database) {}

  async create(input: {
    ownerUserId: string;
    name: string;
    visibility: "PRIVATE" | "INVITE_ONLY" | "PUBLIC";
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const community = await client.query(
        `INSERT INTO communities (
           owner_user_id,
           name,
           visibility
         ) VALUES ($1,$2,$3)
         RETURNING id, created_at`,
        [input.ownerUserId, input.name, input.visibility]
      );

      await client.query(
        `INSERT INTO community_memberships (
           community_id,
           user_id,
           role
         ) VALUES ($1,$2,'OWNER')`,
        [community.rows[0].id, input.ownerUserId]
      );

      await client.query("COMMIT");
      return community.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createChannel(input: {
    communityId: string;
    name: string;
    channelType:
      | "CHAT"
      | "ANNOUNCEMENT"
      | "VOICE_STAGE"
      | "EVENT"
      | "SUPPORT";
    visibility: "PUBLIC" | "MEMBERS" | "ADMINS";
  }) {
    const result = await this.db.query(
      `INSERT INTO community_channels (
         community_id,
         name,
         channel_type,
         visibility
       ) VALUES ($1,$2,$3,$4)
       RETURNING id, created_at`,
      [
        input.communityId,
        input.name,
        input.channelType,
        input.visibility
      ]
    );

    return result.rows[0];
  }
}
