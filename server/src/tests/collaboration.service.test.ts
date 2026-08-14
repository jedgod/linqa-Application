import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { CollaborationService } from "../services/collaboration.service.js";

function mockTransactionalDb(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>
): Database {
  const release = vi.fn();
  return {
    connect: async () => ({ query, release }),
    query
  } as unknown as Database;
}

describe("CollaborationService.createRoom", () => {
  it("creates the room and auto-subscribes the owner's device", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO collaboration_rooms")) {
        return {
          rows: [{ id: "room-1", room_type: "MEETING", status: "ACTIVE", created_at: "now" }],
          rowCount: 1
        };
      }
      if (sql.includes("INSERT INTO collaboration_subscriptions")) {
        expect(params).toEqual(["room-1", "device-owner", "user-owner"]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService(mockTransactionalDb(query));
    const room = await service.createRoom({
      ownerUserId: "user-owner",
      ownerDeviceId: "device-owner",
      titleCiphertext: Buffer.alloc(16, 1),
      roomType: "MEETING"
    });

    expect(room.id).toBe("room-1");
  });

  it("rejects a title ciphertext too short to be real ciphertext", async () => {
    const query = vi.fn();
    const service = new CollaborationService(mockTransactionalDb(query));

    await expect(
      service.createRoom({
        ownerUserId: "user-owner",
        ownerDeviceId: "device-owner",
        titleCiphertext: Buffer.alloc(4),
        roomType: "MEETING"
      })
    ).rejects.toThrow("invalid room title ciphertext");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("CollaborationService.invite", () => {
  it("allows the owner to invite another user's active device", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM collaboration_rooms")) {
        return { rows: [{ owner_user_id: "user-owner", status: "ACTIVE" }], rowCount: 1 };
      }
      if (sql.includes("FROM devices")) {
        return { rows: [{ id: "device-invitee" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO collaboration_subscriptions")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService(mockTransactionalDb(query));
    await expect(
      service.invite({
        roomId: "room-1",
        inviterUserId: "user-owner",
        inviteeUserId: "user-invitee",
        inviteeDeviceId: "device-invitee"
      })
    ).resolves.toBeUndefined();
  });

  it("rejects an invite from a non-owner", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM collaboration_rooms")) {
        return { rows: [{ owner_user_id: "user-owner", status: "ACTIVE" }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService(mockTransactionalDb(query));
    await expect(
      service.invite({
        roomId: "room-1",
        inviterUserId: "user-mallory",
        inviteeUserId: "user-mallory",
        inviteeDeviceId: "device-mallory"
      })
    ).rejects.toThrow("only the room owner can invite participants");
  });

  it("rejects inviting a device that does not belong to the invitee", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM collaboration_rooms")) {
        return { rows: [{ owner_user_id: "user-owner", status: "ACTIVE" }], rowCount: 1 };
      }
      if (sql.includes("FROM devices")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService(mockTransactionalDb(query));
    await expect(
      service.invite({
        roomId: "room-1",
        inviterUserId: "user-owner",
        inviteeUserId: "user-invitee",
        inviteeDeviceId: "someone-elses-device"
      })
    ).rejects.toThrow("invitee device not found");
  });
});

describe("CollaborationService.removeParticipant", () => {
  it("rejects removal by a non-owner", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM collaboration_rooms")) {
        return { rows: [{ owner_user_id: "user-owner" }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService(mockTransactionalDb(query));
    await expect(
      service.removeParticipant({
        roomId: "room-1",
        removedByUserId: "user-mallory",
        deviceId: "device-someone"
      })
    ).rejects.toThrow("only the room owner can remove participants");
  });

  it("refuses to remove the room owner", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM collaboration_rooms")) {
        return { rows: [{ owner_user_id: "user-owner" }], rowCount: 1 };
      }
      if (sql.includes("FROM collaboration_subscriptions")) {
        return { rows: [{ user_id: "user-owner" }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService(mockTransactionalDb(query));
    await expect(
      service.removeParticipant({
        roomId: "room-1",
        removedByUserId: "user-owner",
        deviceId: "device-owner"
      })
    ).rejects.toThrow("the room owner cannot be removed");
  });
});

describe("CollaborationService.append / pull — membership enforcement", () => {
  it("rejects appending an event from a device that is not a room member", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM collaboration_rooms")) {
        return { rows: [{ status: "ACTIVE" }], rowCount: 1 };
      }
      if (sql.includes("FROM collaboration_subscriptions")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService({ query } as unknown as Database);
    await expect(
      service.append({
        roomId: "room-1",
        actorDeviceId: "device-mallory",
        eventType: "POLL_VOTE",
        ciphertext: Buffer.alloc(16, 1),
        logicalClock: 1
      })
    ).rejects.toThrow("device is not a member of this room");
  });

  it("rejects appending into a room that does not exist or is not active", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM collaboration_rooms")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService({ query } as unknown as Database);
    await expect(
      service.append({
        roomId: "room-missing",
        actorDeviceId: "device-1",
        eventType: "POLL_VOTE",
        ciphertext: Buffer.alloc(16, 1),
        logicalClock: 1
      })
    ).rejects.toThrow("room not found");
  });

  it("allows a member device to append and pull", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM collaboration_rooms")) return { rows: [{ status: "ACTIVE" }], rowCount: 1 };
      if (sql.includes("FROM collaboration_subscriptions")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("INSERT INTO collaboration_events")) {
        return { rows: [{ id: "event-1", created_at: "now" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id,actor_device_id")) {
        return { rows: [{ id: "event-1" }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService({ query } as unknown as Database);
    const appended = await service.append({
      roomId: "room-1",
      actorDeviceId: "device-member",
      eventType: "POLL_VOTE",
      ciphertext: Buffer.alloc(16, 1),
      logicalClock: 1
    });
    expect(appended.accepted).toBe(true);

    const pulled = await service.pull({
      roomId: "room-1",
      requesterDeviceId: "device-member",
      afterClock: 0
    });
    expect(pulled).toHaveLength(1);
  });

  it("rejects pulling for a device that is not (or is no longer) a room member", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM collaboration_rooms")) return { rows: [{ status: "ACTIVE" }], rowCount: 1 };
      if (sql.includes("FROM collaboration_subscriptions")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new CollaborationService({ query } as unknown as Database);
    await expect(
      service.pull({
        roomId: "room-1",
        requesterDeviceId: "device-removed",
        afterClock: 0
      })
    ).rejects.toThrow("device is not a member of this room");
  });
});
