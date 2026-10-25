import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { SignJWT } from "jose";
import { ensureTestDatabase } from "./support/test-database.js";
import { loadConfig } from "../config.js";
import { registerAttachmentRoutes } from "../routes/attachments.js";
import { AttachmentService, validateMultipartParts, type ObjectStorage } from "../services/attachment.service.js";
import type { Database } from "../db/pool.js";

const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;
const config = loadConfig();
const ETAG = (n: number) => `"${String(n).padStart(32, "a")}"`;

describe("validateMultipartParts", () => {
  it("accepts exactly the declared parts, in any order, and returns them ordered", () => {
    const out = validateMultipartParts([{ partNumber: 2, etag: ETAG(2) }, { partNumber: 1, etag: ETAG(1) }], 2);
    expect(out.map((p) => p.partNumber)).toEqual([1, 2]);
  });
  it("rejects a wrong count, a gap, a repeat, a part zero, and junk or XML-shaped ETags", () => {
    const ok = (n: number) => ({ partNumber: n, etag: ETAG(n) });
    expect(() => validateMultipartParts([ok(1)], 2)).toThrow("INVALID_PART_COUNT");
    expect(() => validateMultipartParts([ok(1), ok(2), ok(3)], 2)).toThrow("INVALID_PART_COUNT");
    expect(() => validateMultipartParts([ok(1), ok(3)], 2)).toThrow("INVALID_PART_METADATA");
    expect(() => validateMultipartParts([ok(1), ok(1)], 2)).toThrow("INVALID_PART_METADATA");
    expect(() => validateMultipartParts([ok(0), ok(1)], 2)).toThrow("INVALID_PART_METADATA");
    expect(() => validateMultipartParts([ok(1), { partNumber: 2, etag: "x" }], 2)).toThrow("INVALID_PART_METADATA");
    expect(() => validateMultipartParts([ok(1), { partNumber: 2, etag: "</ETag><Part>" + "a".repeat(20) }], 2)).toThrow("INVALID_PART_METADATA");
    expect(() => validateMultipartParts([], 0)).toThrow("INVALID_PART_COUNT");
    expect(() => validateMultipartParts([ok(1)], 10_001)).toThrow("INVALID_PART_COUNT");
  });
});

suite("multipart sessions are bound to the server-created attachment (real PostgreSQL)", () => {
  let db: Database;
  let app: ReturnType<typeof Fastify>;
  const created: string[] = [];
  const calls: { sign: Array<{ uploadId: string; objectKey: string }>; complete: Array<{ uploadId: string; objectKey: string }>; abort: Array<[string, string]> } = { sign: [], complete: [], abort: [] };
  let nextUploadId = "mp-server-session-1";
  let failAbort = false;

  const storage: ObjectStorage = {
    async createMultipartUpload() { return { uploadId: nextUploadId }; },
    async signPartUpload(i) { calls.sign.push({ uploadId: i.uploadId, objectKey: i.objectKey }); return { url: "https://upload.invalid/part" }; },
    async completeMultipartUpload(i) { calls.complete.push({ uploadId: i.uploadId, objectKey: i.objectKey }); },
    async signDownload() { return { url: "https://download.invalid" }; },
    async abortMultipartUpload(key, id) { if (failAbort) throw new Error("storage down"); calls.abort.push([key, id]); },
    async deleteObject() {}
  };

  beforeAll(async () => {
    db = new pg.Pool({ connectionString: database!.connectionString }) as unknown as Database;
    app = Fastify();
    await registerAttachmentRoutes(app, config, db, new AttachmentService(db, storage), { assertEnabledOperation: async () => undefined } as never);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (created.length) {
      await db.query("DELETE FROM status_video_cleanup_jobs WHERE object_key LIKE ANY (SELECT 'attachments/' || x::text || '/%' FROM unnest($1::uuid[]) x)", [created]);
      await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created]);
    }
    await (db as unknown as pg.Pool).end();
  });
  beforeEach(() => { calls.sign.length = 0; calls.complete.length = 0; calls.abort.length = 0; failAbort = false; nextUploadId = "mp-" + randomUUID(); });

  async function person(label: string) {
    const user = randomUUID(), device = randomUUID();
    created.push(user);
    await db.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')", [user, `attachment-session-${label}-${user}`]);
    await db.query("INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status,registered_at) VALUES($1,$2,$3,'ANDROID',$4,$5,'ACTIVE',now())", [device, user, label, randomBytes(32), randomBytes(32)]);
    return { user, device };
  }
  const token = (p: { user: string; device: string }) =>
    new SignJWT({ user_id: p.user, device_id: p.device, scope: "attachments:write" }).setProtectedHeader({ alg: "HS256" }).setSubject(p.user)
      .setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  const call = async (p: { user: string; device: string }, url: string, payload: object) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${await token(p)}` }, payload });
  const create = (p: { user: string; device: string }, over: object = {}) =>
    call(p, "/v1/attachments", { mediaType: "VIDEO", ciphertextSize: 11 * 1024 * 1024, chunkCount: 2, manifestHashBase64: randomBytes(32).toString("base64"), ...over });

  it("the server stores the session it got from storage, and the purpose the client declared", async () => {
    const alice = await person("alice");
    const res = await create(alice, { purpose: "STATUS_VIDEO" });
    expect(res.statusCode).toBe(201);
    const row = (await db.query("SELECT multipart_upload_id, purpose, status FROM attachment_uploads WHERE id=$1", [res.json().attachmentId])).rows[0];
    expect(row).toEqual({ multipart_upload_id: nextUploadId, purpose: "STATUS_VIDEO", status: "UPLOADING" });
    const general = await create(alice);
    expect((await db.query("SELECT purpose FROM attachment_uploads WHERE id=$1", [general.json().attachmentId])).rows[0].purpose).toBe("GENERAL");
    expect((await create(alice, { purpose: "ANYTHING" })).statusCode).toBe(400);
  });

  it("signing a part requires the session id the server holds, and always signs against the stored one", async () => {
    const alice = await person("alice");
    const { attachmentId, uploadId, objectKey } = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    expect((await call(alice, `/v1/attachments/${attachmentId}/parts/1`, { uploadId: "someone-elses-session" })).statusCode).toBe(400);
    expect(calls.sign).toEqual([]);                                                                         // nothing was signed
    expect((await call(alice, `/v1/attachments/${attachmentId}/parts/1`, { uploadId })).statusCode).toBe(200);
    expect(calls.sign).toEqual([{ uploadId, objectKey }]);
    expect((await call(alice, `/v1/attachments/${attachmentId}/parts/3`, { uploadId })).statusCode).toBe(400); // beyond the declared chunk count
  });

  it("completing requires the stored session and a valid parts list, and never forwards the client's id or key", async () => {
    const alice = await person("alice");
    const { attachmentId, uploadId, objectKey } = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    const parts = [{ partNumber: 1, etag: ETAG(1) }, { partNumber: 2, etag: ETAG(2) }];
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId: "forged", parts })).statusCode).toBe(400);
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts: parts.slice(0, 1) })).statusCode).toBe(400);
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts: [parts[0], { partNumber: 3, etag: ETAG(3) }] })).statusCode).toBe(400);
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts: [parts[0], { partNumber: 2, etag: "short" }] })).statusCode).toBe(400);
    expect(calls.complete).toEqual([]);                                                                      // none of that reached storage
    expect((await db.query("SELECT status FROM attachment_uploads WHERE id=$1", [attachmentId])).rows[0].status).toBe("UPLOADING");
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts: [parts[1], parts[0]] })).statusCode).toBe(204);
    expect(calls.complete).toEqual([{ uploadId, objectKey }]);
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts })).statusCode).toBe(400); // cannot complete twice
  });

  it("another user cannot sign, complete or abort someone else's upload", async () => {
    const alice = await person("alice"), mallory = await person("mallory");
    const { attachmentId, uploadId } = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    const parts = [{ partNumber: 1, etag: ETAG(1) }, { partNumber: 2, etag: ETAG(2) }];
    expect((await call(mallory, `/v1/attachments/${attachmentId}/parts/1`, { uploadId })).statusCode).toBe(400);
    expect((await call(mallory, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts })).statusCode).toBe(400);
    expect((await call(mallory, `/v1/attachments/${attachmentId}/abort`, {})).statusCode).toBe(400);
    expect(calls.sign.length + calls.complete.length + calls.abort.length).toBe(0);
  });

  it("an upload from before this change has no stored session and cannot be signed or completed", async () => {
    const alice = await person("alice");
    const { attachmentId, uploadId } = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    await db.query("UPDATE attachment_uploads SET multipart_upload_id = NULL WHERE id=$1", [attachmentId]);
    expect((await call(alice, `/v1/attachments/${attachmentId}/parts/1`, { uploadId })).statusCode).toBe(400);
    expect((await call(alice, `/v1/attachments/${attachmentId}/complete`, { uploadId, parts: [{ partNumber: 1, etag: ETAG(1) }, { partNumber: 2, etag: ETAG(2) }] })).statusCode).toBe(400);
  });

  it("cancelling frees the stored parts, closes the attachment, and cannot be repeated or used after completion", async () => {
    const alice = await person("alice");
    const { attachmentId, uploadId, objectKey } = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    expect((await call(alice, `/v1/attachments/${attachmentId}/abort`, {})).statusCode).toBe(204);
    expect(calls.abort).toEqual([[objectKey, uploadId]]);
    expect((await db.query("SELECT status FROM attachment_uploads WHERE id=$1", [attachmentId])).rows[0].status).toBe("DELETED");
    expect((await call(alice, `/v1/attachments/${attachmentId}/abort`, {})).statusCode).toBe(400);           // already closed
    expect((await call(alice, `/v1/attachments/${attachmentId}/parts/1`, { uploadId })).statusCode).toBe(400); // and unusable
    // A finished upload is not cancellable: it is the post flow's to delete.
    const done = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    await call(alice, `/v1/attachments/${done.attachmentId}/complete`, { uploadId: done.uploadId, parts: [{ partNumber: 1, etag: ETAG(1) }, { partNumber: 2, etag: ETAG(2) }] });
    expect((await call(alice, `/v1/attachments/${done.attachmentId}/abort`, {})).statusCode).toBe(400);
  });

  it("if storage is unreachable when cancelling, the upload is still closed and the freeing is queued", async () => {
    const alice = await person("alice");
    const { attachmentId, uploadId, objectKey } = (await create(alice, { purpose: "STATUS_VIDEO" })).json();
    failAbort = true;
    expect((await call(alice, `/v1/attachments/${attachmentId}/abort`, {})).statusCode).toBe(204);
    expect((await db.query("SELECT status FROM attachment_uploads WHERE id=$1", [attachmentId])).rows[0].status).toBe("DELETED");
    const jobs = (await db.query("SELECT action, status, multipart_upload_id FROM status_video_cleanup_jobs WHERE object_key=$1", [objectKey])).rows;
    expect(jobs).toEqual([{ action: "ABORT_MULTIPART", status: "PENDING", multipart_upload_id: uploadId }]);
  });
});
