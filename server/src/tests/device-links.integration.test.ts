import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Database } from "../db/pool.js";
import { DeviceLinkError, DeviceLinkService, LINK_SESSION_SCOPES, mayUnlink } from "../device-links/device-links.service.js";
import { ensureTestDatabase, type TestDatabase } from "./support/test-database.js";

/** Against a real PostgreSQL: the once-only and expiry rules live in SQL, so a stubbed driver would prove nothing. */
let db: Database;
let testDatabase: TestDatabase | null = null;
testDatabase = await ensureTestDatabase();
const suite = testDatabase ? describe : describe.skip;

const created: Array<{ userId: string; scopes: string[] }> = [];
const sessions = {
  create: async (input: { userId: string; subject: string; scopes: string[] }) => {
    created.push({ userId: input.userId, scopes: input.scopes });
    return { accessToken: `token-for-${input.userId}`, accessTokenExpiresIn: 900, refreshToken: "r", refreshTokenExpiresAt: new Date(), sessionId: randomUUID() };
  }
};

const userIds: string[] = [];
async function makeUser(): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO users (id, external_subject, status) VALUES ($1,$2,'ACTIVE')`, [id, `link-test-${id}`]);
  userIds.push(id);
  return id;
}

const code = async (promise: Promise<unknown>) => {
  try { await promise; return null; } catch (error) { return error instanceof DeviceLinkError ? error.code : String(error); }
};

beforeAll(async () => {
  if (!testDatabase) return;
  db = new pg.Pool({ connectionString: testDatabase.connectionString, max: 6 }) as unknown as Database;
});

afterAll(async () => {
  if (!testDatabase) return;
  await db.query(`DELETE FROM device_link_requests WHERE device_name LIKE 'test-%'`);
  if (userIds.length) await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  await (db as unknown as pg.Pool).end();
  await testDatabase.stop?.();
});

suite("linking a computer by QR code", () => {
  const service = () => new DeviceLinkService(db, sessions);
  const link = () => service().create({ deviceName: "test-Windows Chrome", platform: "WEB" });

  it("stores only a hash of the secret", async () => {
    const { linkId, secret } = await link();
    const row = await db.query(`SELECT secret_hash FROM device_link_requests WHERE id = $1`, [linkId]);
    expect((row.rows[0].secret_hash as Buffer).toString("utf8")).not.toContain(secret);
    expect(secret.length).toBeGreaterThanOrEqual(40);
  });

  it("walks pending to approved to claimed, and the computer receives a limited enrollment session", async () => {
    const userId = await makeUser();
    const { linkId, secret } = await link();
    expect(await service().status(linkId, secret)).toEqual({ status: "PENDING" });
    expect(await service().preview(linkId, secret)).toMatchObject({ deviceName: "test-Windows Chrome", platform: "WEB" });
    expect(await code(service().claim(linkId, secret))).toBe("LINK_NOT_APPROVED");

    await service().approve(linkId, secret, userId, null);
    expect(await service().status(linkId, secret)).toEqual({ status: "APPROVED" });

    const session = await service().claim(linkId, secret);
    expect(session.accessToken).toBe(`token-for-${userId}`);
    expect(created.at(-1)).toEqual({ userId, scopes: [...LINK_SESSION_SCOPES] });
    expect(LINK_SESSION_SCOPES).not.toContain("messages:read");
    expect(await service().status(linkId, secret)).toEqual({ status: "CLAIMED" });
  });

  it("can be claimed only once, even by two computers at the same moment", async () => {
    const userId = await makeUser();
    const { linkId, secret } = await link();
    await service().approve(linkId, secret, userId, null);
    const results = await Promise.all([code(service().claim(linkId, secret)), code(service().claim(linkId, secret)), code(service().claim(linkId, secret))]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "LINK_ALREADY_USED")).toHaveLength(2);
  });

  it("a wrong secret looks like a missing link for every step", async () => {
    const userId = await makeUser();
    const { linkId } = await link();
    const wrong = "x".repeat(43);
    const attempts = [service().status(linkId, wrong), service().preview(linkId, wrong), service().approve(linkId, wrong, userId, null), service().deny(linkId, wrong), service().claim(linkId, wrong)];
    for (const result of await Promise.all(attempts.map(code))) {
      expect(result).toBe("LINK_NOT_FOUND");
    }
    expect(await code(service().status(randomUUID(), wrong))).toBe("LINK_NOT_FOUND");
    expect(await code(service().status("not-a-uuid", wrong))).toBe("LINK_NOT_FOUND");
  });

  it("an expired link cannot be approved or claimed", async () => {
    const userId = await makeUser();
    const { linkId, secret } = await link();
    await db.query(`UPDATE device_link_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [linkId]);
    expect(await service().status(linkId, secret)).toEqual({ status: "EXPIRED" });
    expect(await code(service().approve(linkId, secret, userId, null))).toBe("LINK_EXPIRED");
    expect(await code(service().preview(linkId, secret))).toBe("LINK_EXPIRED");

    const approvedThenExpired = await link();
    await service().approve(approvedThenExpired.linkId, approvedThenExpired.secret, userId, null);
    await db.query(`UPDATE device_link_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [approvedThenExpired.linkId]);
    expect(await code(service().claim(approvedThenExpired.linkId, approvedThenExpired.secret))).toBe("LINK_EXPIRED");
  });

  it("a denied link can never be approved", async () => {
    const userId = await makeUser();
    const { linkId, secret } = await link();
    await service().deny(linkId, secret);
    expect(await service().status(linkId, secret)).toEqual({ status: "DENIED" });
    expect(await code(service().approve(linkId, secret, userId, null))).toBe("LINK_NOT_PENDING");
    expect(await code(service().claim(linkId, secret))).toBe("LINK_NOT_APPROVED");
  });

  it("an approved link cannot be approved again by someone else", async () => {
    const first = await makeUser();
    const second = await makeUser();
    const { linkId, secret } = await link();
    await service().approve(linkId, secret, first, null);
    expect(await code(service().approve(linkId, secret, second, null))).toBe("LINK_NOT_PENDING");
    await service().claim(linkId, secret);
    expect(created.at(-1)?.userId).toBe(first);
  });

  it("rejects empty device names", async () => {
    expect(await code(service().create({ deviceName: "   ", platform: "WEB" }))).toBe("INVALID_REQUEST");
  });
});

describe("who may unlink whom", () => {
  it("a phone can unlink anything; a linked computer can only unlink other computers", () => {
    for (const phone of ["ANDROID", "IOS"]) for (const target of ["ANDROID", "IOS", "WEB", "DESKTOP"]) expect(mayUnlink(phone, target)).toBe(true);
    for (const computer of ["WEB", "DESKTOP"]) {
      expect(mayUnlink(computer, "WEB")).toBe(true);
      expect(mayUnlink(computer, "DESKTOP")).toBe(true);
      expect(mayUnlink(computer, "ANDROID")).toBe(false);
      expect(mayUnlink(computer, "IOS")).toBe(false);
    }
  });
});
