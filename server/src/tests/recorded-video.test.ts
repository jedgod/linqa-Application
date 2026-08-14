import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { RecordedVideoService } from "../services/recorded-video.service.js";

function validInput(overrides: Partial<Parameters<RecordedVideoService["create"]>[0]> = {}) {
  return {
    ownerUserId: "user-1",
    ownerDeviceId: "device-1",
    recipientUserId: "user-2",
    attachmentId: "attachment-1",
    ciphertextSize: 2048,
    durationSeconds: 30,
    recordedAt: new Date("2026-01-01T00:00:00.000Z"),
    retentionPolicy: "DELETE_24_HOURS" as const,
    ...overrides
  };
}

function mockClient(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  const release = vi.fn();
  return {
    connect: async () => ({ query, release }),
    release
  };
}

describe("RecordedVideoService", () => {
  it("binds the disclosure record to an owner's completed attachment upload", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM attachment_uploads")) {
        expect(params).toEqual(["attachment-1", "user-1"]);
        return {
          rows: [{ object_key: "attachments/user-1/real-key", ciphertext_size: "2048" }],
          rowCount: 1
        };
      }
      if (sql.includes("INSERT INTO recorded_video_assets")) {
        expect(params?.[3]).toBe("attachments/user-1/real-key");
        return { rows: [{ id: "asset-1", created_at: "2026-01-01T00:00:00.000Z" }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const db = mockClient(query);
    const service = new RecordedVideoService(db as unknown as Database);

    const result = await service.create(validInput());

    expect(result.id).toBe("asset-1");
    expect(result.objectKey).toBe("attachments/user-1/real-key");
  });

  it("refuses to register a video against an attachment that is not the caller's own completed upload", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM attachment_uploads")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    });
    const db = mockClient(query);
    const service = new RecordedVideoService(db as unknown as Database);

    await expect(service.create(validInput())).rejects.toThrow(
      "recorded video attachment upload not found or incomplete"
    );
  });

  it("rejects a claimed size that does not match the completed upload", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM attachment_uploads")) {
        return {
          rows: [{ object_key: "attachments/user-1/real-key", ciphertext_size: "999" }],
          rowCount: 1
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const db = mockClient(query);
    const service = new RecordedVideoService(db as unknown as Database);

    await expect(service.create(validInput({ ciphertextSize: 2048 }))).rejects.toThrow(
      "recorded video size does not match the completed upload"
    );
  });
});
