import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { AttachmentService, type ObjectStorage } from "../services/attachment.service.js";
import { CallService } from "../services/call.service.js";

function databaseWith(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  const release = vi.fn();
  return {
    database: {
      connect: async () => ({ query, release })
    } as unknown as Database,
    release
  };
}

describe("lifecycle completion", () => {
  it("records participant call history before committing a terminal call", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("FROM call_sessions")) {
        return {
          rows: [{
            status: "ACTIVE",
            call_type: "VIDEO",
            started_at: new Date("2026-08-08T00:00:00Z"),
            created_at: new Date("2026-08-08T00:00:00Z")
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const { database, release } = databaseWith(query);

    await new CallService(database).end("call-1", "device-1");

    const historyIndex = statements.findIndex((sql) => sql.includes("INSERT INTO call_history"));
    const commitIndex = statements.indexOf("COMMIT");
    expect(historyIndex).toBeGreaterThan(0);
    expect(historyIndex).toBeLessThan(commitIndex);
    expect(release).toHaveBeenCalledOnce();
  });

  it("indexes completed encrypted media before committing the upload", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("FROM attachment_uploads")) {
        return {
          rows: [{
            object_key: "attachments/user-1/object-1",
            chunk_count: 1,
            status: "UPLOADING",
            media_type: "IMAGE",
            manifest_hash: Buffer.alloc(32, 7)
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const { database, release } = databaseWith(query);
    const storage = {
      completeMultipartUpload: vi.fn(async () => undefined)
    } as unknown as ObjectStorage;

    await new AttachmentService(database, storage).complete({
      userId: "user-1",
      attachmentId: "attachment-1",
      uploadId: "upload-1",
      parts: [{ partNumber: 1, etag: "etag-1" }]
    });

    const mediaIndex = statements.findIndex((sql) => sql.includes("INSERT INTO media_index"));
    const commitIndex = statements.indexOf("COMMIT");
    expect(mediaIndex).toBeGreaterThan(0);
    expect(mediaIndex).toBeLessThan(commitIndex);
    expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});