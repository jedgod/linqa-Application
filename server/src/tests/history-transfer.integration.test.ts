import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Database } from "../db/pool.js";
import { HistoryTransferError, HistoryTransferService, LIMITS } from "../history-transfer/history-transfer.service.js";
import { ensureTestDatabase, type TestDatabase } from "./support/test-database.js";

/** Against a real PostgreSQL: the once-only, ownership and expiry rules live in SQL. */
let db: Database;
let testDatabase: TestDatabase | null = null;
testDatabase = await ensureTestDatabase();
const suite = testDatabase ? describe : describe.skip;

const userIds: string[] = [];
async function makeUser() {
  const id = randomUUID();
  await db.query(`INSERT INTO users (id, external_subject, status) VALUES ($1,$2,'ACTIVE')`, [id, `history-test-${id}`]);
  userIds.push(id);
  return id;
}
async function makeDevice(userId: string, platform: "ANDROID" | "WEB", name = "test device") {
  const id = randomUUID();
  await db.query(
    `INSERT INTO devices (id, user_id, device_name, platform, signing_public_key, encryption_public_key, status, registered_at)
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now())`,
    [id, userId, name, platform, Buffer.from(randomUUID() + randomUUID()), Buffer.from(randomUUID() + randomUUID())]
  );
  return id;
}
const code = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return error instanceof HistoryTransferError ? error.code : String(error); } };
const chunk = (text: string) => Buffer.from(text);

beforeAll(async () => {
  if (!testDatabase) return;
  db = new pg.Pool({ connectionString: testDatabase.connectionString, max: 6 }) as unknown as Database;
});
afterAll(async () => {
  if (!testDatabase) return;
  if (userIds.length) await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  await (db as unknown as pg.Pool).end();
  await testDatabase.stop?.();
});

suite("bringing history to a linked computer", () => {
  const service = () => new HistoryTransferService(db);
  async function setup() {
    const user = await makeUser();
    return { user, phone: await makeDevice(user, "ANDROID"), computer: await makeDevice(user, "WEB", "Chrome on Windows") };
  }

  it("walks from a request to a completed transfer, and deletes the chunks at the end", async () => {
    const { user, phone, computer } = await setup();
    const { id } = await service().request(user, computer);
    expect((await service().view(user, id)).status).toBe("REQUESTED");
    expect((await service().pendingFor(user, phone)).map((p) => p.id)).toEqual([id]);

    expect(await service().approve(user, phone, id)).toEqual({ computerDeviceId: computer });
    await service().putChunk(user, phone, id, 0, chunk("sealed-0"), { done: 1, total: 2 });
    expect(await service().view(user, id)).toMatchObject({ status: "UPLOADING", progress: { done: 1, total: 2 }, requesterName: "Chrome on Windows" });
    await service().putChunk(user, phone, id, 1, chunk("sealed-1"), { done: 2, total: 2 });
    await service().finish(user, phone, id, 2);
    expect(await service().view(user, id)).toMatchObject({ status: "READY", chunkCount: 2 });

    expect((await service().getChunk(user, computer, id, 0)).toString()).toBe("sealed-0");
    expect((await service().getChunk(user, computer, id, 1)).toString()).toBe("sealed-1");
    await service().complete(user, computer, id);
    expect((await service().view(user, id)).status).toBe("COMPLETE");
    const left = await db.query(`SELECT count(*)::int AS n FROM history_transfer_chunks WHERE transfer_id = $1`, [id]);
    expect(left.rows[0].n).toBe(0);
  });

  it("only a phone can approve or list requests, and only a computer can ask", async () => {
    const { user, phone, computer } = await setup();
    expect(await code(service().request(user, phone))).toBe("COMPUTER_REQUIRED");
    const { id } = await service().request(user, computer);
    expect(await code(service().approve(user, computer, id))).toBe("PHONE_REQUIRED");
    expect(await code(service().pendingFor(user, computer))).toBe("PHONE_REQUIRED");
    expect(await code(service().decline(user, computer, id))).toBe("PHONE_REQUIRED");
  });

  it("someone else's account cannot see or touch a transfer", async () => {
    const { user, phone, computer } = await setup();
    const other = await setup();
    const { id } = await service().request(user, computer);
    expect(await code(service().view(other.user, id))).toBe("NOT_FOUND");
    expect(await code(service().approve(other.user, other.phone, id))).toBe("NOT_FOUND");
    expect(await code(service().getChunk(other.user, other.computer, id, 0))).toBe("NOT_FOUND");
    expect((await service().pendingFor(other.user, other.phone)).length).toBe(0);
    await service().approve(user, phone, id);
  });

  it("only the phone that approved can upload, and only the requesting computer can download or complete", async () => {
    const { user, phone, computer } = await setup();
    const secondPhone = await makeDevice(user, "ANDROID");
    const secondComputer = await makeDevice(user, "WEB", "Firefox");
    const { id } = await service().request(user, computer);
    await service().approve(user, phone, id);
    expect(await code(service().putChunk(user, secondPhone, id, 0, chunk("x")))).toBe("NOT_ALLOWED");
    await service().putChunk(user, phone, id, 0, chunk("x"));
    await service().finish(user, phone, id, 1);
    expect(await code(service().getChunk(user, secondComputer, id, 0))).toBe("NOT_ALLOWED");
    expect(await code(service().complete(user, secondComputer, id))).toBe("NOT_ALLOWED");
    expect(await code(service().approve(user, secondPhone, id))).toBe("WRONG_STATE");
  });

  it("a request can be approved once, even by two phones at the same moment", async () => {
    const { user, phone, computer } = await setup();
    const secondPhone = await makeDevice(user, "ANDROID");
    const { id } = await service().request(user, computer);
    const results = await Promise.all([code(service().approve(user, phone, id)), code(service().approve(user, secondPhone, id))]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "WRONG_STATE")).toHaveLength(1);
  });

  it("one open request per computer; a finished one frees it", async () => {
    const { user, phone, computer } = await setup();
    const { id } = await service().request(user, computer);
    expect(await code(service().request(user, computer))).toBe("ALREADY_OPEN");
    await service().decline(user, phone, id);
    expect((await service().view(user, id)).status).toBe("DECLINED");
    expect(await code(service().request(user, computer))).toBeNull();
  });

  it("refuses chunks that are empty, too big, or out of range, and a finish with gaps or a wrong count", async () => {
    const { user, phone, computer } = await setup();
    const { id } = await service().request(user, computer);
    await service().approve(user, phone, id);
    expect(await code(service().putChunk(user, phone, id, 0, Buffer.alloc(0)))).toBe("BAD_CHUNK");
    expect(await code(service().putChunk(user, phone, id, 0, Buffer.alloc(LIMITS.chunkBytes + 1)))).toBe("BAD_CHUNK");
    expect(await code(service().putChunk(user, phone, id, LIMITS.maxChunks, chunk("x")))).toBe("BAD_CHUNK");
    await service().putChunk(user, phone, id, 0, chunk("a"));
    await service().putChunk(user, phone, id, 2, chunk("c"));
    expect(await code(service().finish(user, phone, id, 3))).toBe("INCOMPLETE");
    expect(await code(service().finish(user, phone, id, 2))).toBe("INCOMPLETE");
    await service().putChunk(user, phone, id, 1, chunk("b"));
    expect(await code(service().finish(user, phone, id, 3))).toBeNull();
  });

  it("nothing can be downloaded before the phone has finished", async () => {
    const { user, phone, computer } = await setup();
    const { id } = await service().request(user, computer);
    await service().approve(user, phone, id);
    await service().putChunk(user, phone, id, 0, chunk("a"));
    expect(await code(service().getChunk(user, computer, id, 0))).toBe("WRONG_STATE");
  });

  it("cancelling, a phone failure, and running out of time all delete the chunks", async () => {
    const { user, phone, computer } = await setup();
    const cancelled = await service().request(user, computer);
    await service().approve(user, phone, cancelled.id);
    await service().putChunk(user, phone, cancelled.id, 0, chunk("a"));
    await service().cancel(user, computer, cancelled.id);
    expect((await service().view(user, cancelled.id)).status).toBe("CANCELLED");

    const failed = await service().request(user, computer);
    await service().approve(user, phone, failed.id);
    await service().putChunk(user, phone, failed.id, 0, chunk("a"));
    await service().fail(user, phone, failed.id, "ARCHIVE_FAILED");
    expect(await service().view(user, failed.id)).toMatchObject({ status: "FAILED", failure: "ARCHIVE_FAILED" });

    const late = await service().request(user, computer);
    await service().approve(user, phone, late.id);
    await service().putChunk(user, phone, late.id, 0, chunk("a"));
    await db.query(`UPDATE history_transfers SET expires_at = now() - interval '1 second' WHERE id = $1`, [late.id]);
    expect(await service().view(user, late.id)).toMatchObject({ status: "FAILED", expired: true });
    expect(await code(service().putChunk(user, phone, late.id, 1, chunk("b")))).toBe("EXPIRED");

    for (const id of [cancelled.id, failed.id, late.id]) {
      const left = await db.query(`SELECT count(*)::int AS n FROM history_transfer_chunks WHERE transfer_id = $1`, [id]);
      expect(left.rows[0].n).toBe(0);
    }
  });

  it("an unanswered request expires, and reports whether a phone has checked in recently", async () => {
    const { user, phone, computer } = await setup();
    const { id } = await service().request(user, computer);
    expect((await service().view(user, id)).phoneOnline).toBe(false);
    await service().pendingFor(user, phone);
    expect((await service().view(user, id)).phoneOnline).toBe(true);
    await db.query(`UPDATE history_transfers SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
    expect((await service().pendingFor(user, phone)).length).toBe(0);
    expect(await code(service().approve(user, phone, id))).toBe("EXPIRED");
  });
});
