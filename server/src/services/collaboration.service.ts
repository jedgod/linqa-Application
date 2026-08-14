import type { Database } from "../db/pool.js";

const ROOM_TYPES = ["MEETING", "WHITEBOARD", "TASK_ROOM", "EVENT", "COMMUNITY_STAGE"] as const;
export type CollaborationRoomType = (typeof ROOM_TYPES)[number];

export class CollaborationService {
  constructor(private readonly db: Database) {}

  async createRoom(input: {
    ownerUserId: string;
    ownerDeviceId: string;
    titleCiphertext: Buffer;
    roomType: CollaborationRoomType;
    expiresAt?: Date;
  }) {
    if (input.titleCiphertext.length < 16) {
      throw new Error("invalid room title ciphertext");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const room = await client.query(
        `INSERT INTO collaboration_rooms(owner_user_id, title_ciphertext, room_type, expires_at)
         VALUES ($1,$2,$3,$4)
         RETURNING id, room_type, status, created_at`,
        [
          input.ownerUserId,
          input.titleCiphertext,
          input.roomType,
          input.expiresAt ?? null
        ]
      );
      const roomId = room.rows[0].id as string;

      await client.query(
        `INSERT INTO collaboration_subscriptions(room_id, device_id, user_id)
         VALUES ($1,$2,$3)`,
        [roomId, input.ownerDeviceId, input.ownerUserId]
      );

      await client.query("COMMIT");
      return room.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Only the room owner can invite participants — collaboration_rooms has
   * no admin/moderator role, just a single owner, so this keeps the trust
   * boundary unambiguous rather than inventing an RBAC tier the schema
   * doesn't have.
   */
  async invite(input: {
    roomId: string;
    inviterUserId: string;
    inviteeUserId: string;
    inviteeDeviceId: string;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const room = await client.query(
        `SELECT owner_user_id, status
         FROM collaboration_rooms
         WHERE id = $1
         FOR UPDATE`,
        [input.roomId]
      );
      const roomRow = room.rows[0];
      if (!roomRow) throw new Error("room not found");
      if (roomRow.status !== "ACTIVE") throw new Error("room is not active");
      if (roomRow.owner_user_id !== input.inviterUserId) {
        throw new Error("only the room owner can invite participants");
      }

      const device = await client.query(
        `SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
        [input.inviteeDeviceId, input.inviteeUserId]
      );
      if (!device.rowCount) throw new Error("invitee device not found");

      await client.query(
        `INSERT INTO collaboration_subscriptions(room_id, device_id, user_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (room_id, device_id)
         DO UPDATE SET user_id = EXCLUDED.user_id, removed_at = NULL`,
        [input.roomId, input.inviteeDeviceId, input.inviteeUserId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeParticipant(input: {
    roomId: string;
    removedByUserId: string;
    deviceId: string;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const room = await client.query(
        `SELECT owner_user_id FROM collaboration_rooms WHERE id = $1 FOR UPDATE`,
        [input.roomId]
      );
      const roomRow = room.rows[0];
      if (!roomRow) throw new Error("room not found");
      if (roomRow.owner_user_id !== input.removedByUserId) {
        throw new Error("only the room owner can remove participants");
      }

      const target = await client.query(
        `SELECT user_id FROM collaboration_subscriptions
         WHERE room_id = $1 AND device_id = $2 AND removed_at IS NULL`,
        [input.roomId, input.deviceId]
      );
      if (target.rows[0]?.user_id === roomRow.owner_user_id) {
        throw new Error("the room owner cannot be removed");
      }

      await client.query(
        `UPDATE collaboration_subscriptions
         SET removed_at = now()
         WHERE room_id = $1 AND device_id = $2 AND removed_at IS NULL`,
        [input.roomId, input.deviceId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async append(input: {
    roomId: string;
    actorDeviceId: string;
    eventType: string;
    ciphertext: Buffer;
    logicalClock: number;
  }) {
    if (input.ciphertext.length < 16) throw new Error("invalid ciphertext");

    await this.requireActiveMembership(input.roomId, input.actorDeviceId);

    const result = await this.db.query(
      `INSERT INTO collaboration_events(
         room_id,actor_device_id,event_type,ciphertext,logical_clock
       ) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(room_id,actor_device_id,logical_clock) DO NOTHING
       RETURNING id,created_at`,
      [input.roomId, input.actorDeviceId, input.eventType, input.ciphertext, input.logicalClock]
    );

    return { accepted: result.rowCount === 1, event: result.rows[0] ?? null };
  }

  async pull(input: {
    roomId: string;
    requesterDeviceId: string;
    afterClock: number;
    limit?: number;
  }) {
    await this.requireActiveMembership(input.roomId, input.requesterDeviceId);

    const result = await this.db.query(
      `SELECT id,actor_device_id,event_type,ciphertext,logical_clock,created_at
       FROM collaboration_events
       WHERE room_id=$1 AND logical_clock>$2
       ORDER BY logical_clock,created_at
       LIMIT $3`,
      [input.roomId, input.afterClock, input.limit ?? 200]
    );
    return result.rows;
  }

  private async requireActiveMembership(roomId: string, deviceId: string): Promise<void> {
    const room = await this.db.query(
      `SELECT status FROM collaboration_rooms WHERE id = $1`,
      [roomId]
    );
    if (!room.rows[0] || room.rows[0].status !== "ACTIVE") {
      throw new Error("room not found");
    }

    const membership = await this.db.query(
      `SELECT 1 FROM collaboration_subscriptions
       WHERE room_id = $1 AND device_id = $2 AND removed_at IS NULL`,
      [roomId, deviceId]
    );
    if (!membership.rowCount) {
      throw new Error("device is not a member of this room");
    }
  }
}
