import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ adapter: null }));
vi.mock("../../../clients/mobile/node_modules/expo-sqlite", () => ({ openDatabaseAsync: async () => native.adapter }));
vi.mock("../../../clients/mobile/node_modules/expo-crypto", async () => {
  const { randomBytes } = await import("node:crypto");
  return { getRandomBytes: size => randomBytes(size) };
});
vi.mock("../../../clients/mobile/src/messaging/offline-metadata-key", () => ({ loadOfflineMetadataKey: async () => new Uint8Array(32).fill(7) }));

let sqlite;
const account = "private-account", conversation = "private-conversation";
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  const transaction = async fn => {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const value = await fn(native.adapter); sqlite.exec("COMMIT"); return value; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  };
  native.adapter = {
    execAsync: async sql => sqlite.exec(sql),
    runAsync: async (sql, ...args) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
    getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
    withExclusiveTransactionAsync: transaction, withTransactionAsync: transaction
  };
});
afterEach(() => { sqlite.close(); });

async function open() {
  const { ExpoSqliteMobileOutboxDb } = await import("../../../clients/mobile/src/messaging/sqlite-outbox");
  return ExpoSqliteMobileOutboxDb.open(account);
}
const message = { messageId: "message", accountId: account, conversationId: conversation, recipientDeviceId: "private-device", encryptedEnvelopeB64: "original-e2ee", state: "QUEUED", attempts: 0, nextAttemptAt: 1, createdAt: 1 };

it("stores protected rows in real SQLite and restores retry/failure operations", async () => {
  const db = await open(); await db.insert(message);
  const bytes = JSON.stringify(sqlite.prepare("SELECT * FROM encrypted_mobile_outbox").all());
  for (const secret of [account, conversation, "private-device", "original-e2ee"]) expect(bytes).not.toContain(secret);
  expect((await db.find("message")).encryptedEnvelopeB64).toBe("original-e2ee");
  await db.update("message", { attempts: 2 });
  expect((await db.due(10))[0].attempts).toBe(2);
  await db.markPermanent(conversation, "message", "REFUSED");
  expect((await db.listPermanent(conversation))[0].conversationId).toBe(conversation);
  await db.deletePermanent(conversation, "message");
  expect(await db.find("message")).toBe(null);
});

it("migrates legacy message/media rows atomically and survives reopening", async () => {
  await open(); // create the legacy-compatible tables
  sqlite.prepare("INSERT INTO encrypted_mobile_outbox VALUES(?,?,?,?,?,?,?,?,?,?)").run("legacy", account, conversation, "private-device", "legacy-e2ee", "QUEUED", 0, 1, 1, null);
  sqlite.prepare("INSERT INTO encrypted_media_uploads_v1 VALUES(?,?,?,?,?,?,?)").run("legacy", account, conversation, "private-device", "private-media", "legacy-media-envelope", "legacy-e2ee");
  const db = await open();
  expect((await db.find("legacy")).encryptedEnvelopeB64).toBe("legacy-e2ee");
  expect((await db.findMedia("legacy")).envelope).toBe("legacy-media-envelope");
  for (const table of ["encrypted_mobile_outbox", "encrypted_media_uploads_v1"]) {
    const stored = JSON.stringify(sqlite.prepare(`SELECT * FROM ${table}`).all());
    for (const secret of [account, conversation, "private-device", "legacy-e2ee", "legacy-media-envelope"]) expect(stored).not.toContain(secret);
  }
  expect((await (await open()).pending(10))[0].encryptedEnvelopeB64).toBe("legacy-e2ee");
});

it("queues media with exact retry bytes and account isolation", async () => {
  const db = await open();
  const row = { messageId: "media", conversationId: conversation, deviceId: "private-device", mediaId: "private-media", envelope: "media-e2ee", ciphertext: "message-e2ee" };
  await db.putMedia(row); await db.putMedia(row);
  expect(await db.findMedia("media")).toEqual(row);
  expect((await db.find("media")).encryptedEnvelopeB64).toBe("message-e2ee");
  await expect(db.putMedia({ ...row, ciphertext: "changed" })).rejects.toThrow("MEDIA_ID_REUSE");
});

it("rolls back the entire legacy upgrade if a row cannot be migrated", async () => {
  await open();
  const insert = sqlite.prepare("INSERT INTO encrypted_mobile_outbox VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (const id of ["one", "two"]) insert.run(id, account, conversation, "private-device", "legacy-e2ee", "QUEUED", 0, 1, 1, null);
  const run = native.adapter.runAsync;
  let updates = 0;
  native.adapter.runAsync = async (sql, ...args) => {
    if (sql.startsWith("UPDATE encrypted_mobile_outbox") && ++updates === 2) throw new Error("simulated storage failure");
    return run(sql, ...args);
  };
  await expect(open()).rejects.toThrow("simulated storage failure");
  expect(sqlite.prepare("SELECT account_id FROM encrypted_mobile_outbox").all().map(row => row.account_id)).toEqual([account, account]);
  native.adapter.runAsync = run;
  expect((await (await open()).pending(10)).length).toBe(2);
});
