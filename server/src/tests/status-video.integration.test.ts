import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { SignJWT } from "jose";
import { ensureTestDatabase } from "./support/test-database.js";
import { loadConfig } from "../config.js";
import { registerStatusVideoRoutes } from "../routes/status-videos.js";
import { StatusVideoService } from "../services/status-video.service.js";
import type { ObjectStorage } from "../services/attachment.service.js";
import type { Database } from "../db/pool.js";

const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;
const config = loadConfig();

type Person = { user: string; phone: string };

suite("encrypted status video posts (real PostgreSQL)", () => {
  let db: Database;
  let app: ReturnType<typeof Fastify>;
  let service: StatusVideoService;
  const created: string[] = [];
  const deletedKeys: string[] = [];
  const signedKeys: string[] = [];
  let failDelete = false;

  const storage: ObjectStorage = {
    async createMultipartUpload() { return { uploadId: "u" }; },
    async signPartUpload() { return { url: "https://upload.invalid" }; },
    async completeMultipartUpload() {},
    async signDownload(input) { signedKeys.push(input.objectKey); return { url: `https://download.invalid/${encodeURIComponent(input.objectKey)}` }; },
    async deleteObject(key) { if (failDelete) throw new Error("storage down"); deletedKeys.push(key); }
  };

  beforeAll(async () => {
    db = new pg.Pool({ connectionString: database!.connectionString }) as unknown as Database;
    service = new StatusVideoService(db, storage);
    app = Fastify();
    await registerStatusVideoRoutes(app, config, service);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (created.length) {
      // conversations.created_by_user_id has no cascade, so remove the ones this suite made before the users.
      await db.query("DELETE FROM conversations WHERE created_by_user_id = ANY($1::uuid[])", [created]);
      // retention_overrides points at posts by plain id (no foreign key), so it does not cascade.
      await db.query("DELETE FROM retention_overrides WHERE resource_type = 'STATUS_VIDEO' AND created_by = 'test'");
      await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created]);
    }
    await (db as unknown as pg.Pool).end();
  });
  beforeEach(() => { deletedKeys.length = 0; signedKeys.length = 0; failDelete = false; });

  async function person(label: string): Promise<Person> {
    const user = randomUUID(), phone = randomUUID();
    created.push(user);
    await db.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')", [user, `status-video-${label}-${user}`]);
    await db.query(
      "INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status,registered_at) VALUES($1,$2,$3,'ANDROID',$4,$5,'ACTIVE',now())",
      [phone, user, `${label} phone`, randomBytes(32), randomBytes(32)]
    );
    return { user, phone };
  }
  const befriend = (a: Person, b: Person) => db.query(
    "INSERT INTO chat_contacts(owner_user_id,contact_user_id,created_via) VALUES($1,$2,'QR'),($2,$1,'QR') ON CONFLICT DO NOTHING", [a.user, b.user]);
  const block = (blocker: Person, blocked: Person) => db.query("INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)", [blocker.user, blocked.user]);
  async function upload(owner: Person, over: { size?: number; status?: string; type?: string } = {}) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO attachment_uploads(id,owner_user_id,owner_device_id,object_key,media_type,ciphertext_size,chunk_count,manifest_hash,status,expires_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,3,$7,$8,now()+interval '1 day',now())`,
      [id, owner.user, owner.phone, `attachments/${owner.user}/${id}`, over.type ?? "VIDEO", over.size ?? 12_345_678, randomBytes(32), over.status ?? "COMPLETE"]
    );
    return { id, size: over.size ?? 12_345_678, key: `attachments/${owner.user}/${id}` };
  }
  const token = (p: Person, scope: string, device: string | null = p.phone) =>
    new SignJWT({ user_id: p.user, ...(device ? { device_id: device } : {}), scope }).setProtectedHeader({ alg: "HS256" }).setSubject(p.user)
      .setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  const call = async (method: "GET" | "POST" | "DELETE", url: string, p: Person, scope: string, payload?: unknown, device: string | null = p.phone) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${await token(p, scope, device)}` }, ...(payload ? { payload: payload as object } : {}) });
  const post = (owner: Person, up: { id: string; size: number }, recipients: Array<{ userId: string; deviceId: string; sealedKey?: string }>, over: object = {}) =>
    call("POST", "/v1/status-videos", owner, "status:write", {
      attachmentId: up.id, kind: "PODCAST", durationSeconds: 600, ciphertextSize: up.size,
      recipients: recipients.map((r) => ({ sealedKey: r.sealedKey ?? "sealed-for-" + r.deviceId.slice(0, 8), ...r })), ...over
    });

  it("a post reaches exactly the chosen friends' devices: they can list, download and mark it viewed", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const up = await upload(alice);
    const res = await post(alice, up, [{ userId: alice.user, deviceId: alice.phone }, { userId: bob.user, deviceId: bob.phone, sealedKey: "BOB-ONLY-BUNDLE" }]);
    expect(res.statusCode).toBe(201);
    const { id, deliveredToDevices } = res.json();
    expect(deliveredToDevices).toBe(2);

    const feed = (await call("GET", "/v1/status-videos/feed", bob, "status:react")).json().items;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ id, ownerUserId: alice.user, kind: "PODCAST", durationSeconds: 600, ciphertextSize: up.size, sealedKey: "BOB-ONLY-BUNDLE", viewedAt: null });
    expect(JSON.stringify(feed)).not.toContain(up.key); // the storage location is never handed to a viewer

    const dl = await call("POST", `/v1/status-videos/${id}/download`, bob, "status:react");
    expect(dl.statusCode).toBe(200);
    expect(dl.json().url).toContain(encodeURIComponent(up.key));
    expect(dl.json().expiresInSeconds).toBeLessThanOrEqual(300);
    expect(signedKeys).toEqual([up.key]);

    expect((await call("POST", `/v1/status-videos/${id}/viewed`, bob, "status:react")).statusCode).toBe(204);
    const mine = (await call("GET", "/v1/status-videos/mine", alice, "status:write")).json().items;
    expect(mine).toEqual([expect.objectContaining({ id, deliveredToDevices: 2, viewedByDevices: 1 })]);
    // the owner's own phone also holds a bundle, so she can watch it back
    expect((await call("GET", "/v1/status-videos/feed", alice, "status:react")).json().items).toHaveLength(1);
  });

  it("a stranger who was not chosen can neither list nor download it, and gets the same answer as for a post that does not exist", async () => {
    const alice = await person("alice"), bob = await person("bob"), carol = await person("carol");
    await befriend(alice, bob);
    const up = await upload(alice);
    const { id } = (await post(alice, up, [{ userId: bob.user, deviceId: bob.phone }])).json();
    expect((await call("GET", "/v1/status-videos/feed", carol, "status:react")).json().items).toEqual([]);
    const real = await call("POST", `/v1/status-videos/${id}/download`, carol, "status:react");
    const missing = await call("POST", `/v1/status-videos/${randomUUID()}/download`, carol, "status:react");
    expect([real.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(real.json()).toEqual(missing.json());
    expect((await call("POST", `/v1/status-videos/${id}/viewed`, carol, "status:react")).statusCode).toBe(404);
    expect(signedKeys).toEqual([]);
  });

  it("bundles are per device: another device of the same friend gets nothing unless it was given a bundle", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const tablet = randomUUID();
    await db.query("INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status,registered_at) VALUES($1,$2,'tablet','ANDROID',$3,$4,'ACTIVE',now())", [tablet, bob.user, randomBytes(32), randomBytes(32)]);
    const { id } = (await post(alice, await upload(alice), [{ userId: bob.user, deviceId: bob.phone }])).json();
    expect((await call("POST", `/v1/status-videos/${id}/download`, bob, "status:react", undefined, tablet)).statusCode).toBe(404);
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:react", undefined, tablet)).json().items).toEqual([]);
  });

  it("refuses recipients who are not connected, or are blocked in either direction, without saying which", async () => {
    const alice = await person("alice"), bob = await person("bob"), carol = await person("carol"), dave = await person("dave"), erin = await person("erin");
    await befriend(alice, bob); await befriend(alice, dave); await befriend(alice, erin);
    await block(alice, dave);   // alice blocked dave
    await block(erin, alice);   // erin blocked alice
    for (const bad of [carol, dave, erin]) {
      const res = await post(alice, await upload(alice), [{ userId: bob.user, deviceId: bob.phone }, { userId: bad.user, deviceId: bad.phone }]);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "invalid_audience" });
    }
    const n = await db.query("SELECT count(*)::int AS n FROM status_video_posts WHERE owner_user_id=$1", [alice.user]);
    expect(n.rows[0].n).toBe(0); // all-or-nothing: nothing was stored for the partly valid lists
  });

  it("people who share a conversation count as connected, but only while both are still in it", async () => {
    const alice = await person("alice"), frank = await person("frank");
    const conv = randomUUID();
    await db.query("INSERT INTO conversations(id,conversation_type,created_by_user_id) VALUES($1,'DIRECT',$2)", [conv, alice.user]);
    await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER')", [conv, alice.user, frank.user]);
    expect((await post(alice, await upload(alice), [{ userId: frank.user, deviceId: frank.phone }])).statusCode).toBe(201);
    await db.query("UPDATE conversation_members SET removed_at=now() WHERE conversation_id=$1 AND user_id=$2", [conv, frank.user]);
    expect((await post(alice, await upload(alice), [{ userId: frank.user, deviceId: frank.phone }])).statusCode).toBe(422);
  });

  it("a device that is not an active device of the listed user is refused (wrong owner, revoked)", async () => {
    const alice = await person("alice"), bob = await person("bob"), carol = await person("carol");
    await befriend(alice, bob);
    const other = await post(alice, await upload(alice), [{ userId: bob.user, deviceId: carol.phone }]); // carol's device under bob
    expect(other.statusCode).toBe(422);
    await db.query("UPDATE devices SET status='REVOKED', revoked_at=now() WHERE id=$1", [bob.phone]);
    expect((await post(alice, await upload(alice), [{ userId: bob.user, deviceId: bob.phone }])).statusCode).toBe(422);
  });

  it("the upload must be the caller's own, completed, of the declared size and type, and backs one post only", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const to = [{ userId: bob.user, deviceId: bob.phone }];
    const bobsUpload = await upload(bob);
    expect((await post(alice, bobsUpload, to)).json()).toEqual({ error: "invalid_upload" });                        // not hers
    expect((await post(alice, await upload(alice, { status: "UPLOADING" }), to)).json()).toEqual({ error: "invalid_upload" }); // unfinished
    expect((await post(alice, await upload(alice, { type: "IMAGE" }), to)).json()).toEqual({ error: "invalid_upload" });      // not a video
    const sized = await upload(alice, { size: 5_000_000 });
    expect((await post(alice, { ...sized, size: 5_000_001 }, to)).json()).toEqual({ error: "invalid_upload" });             // size mismatch
    const once = await upload(alice);
    expect((await post(alice, once, to)).statusCode).toBe(201);
    expect((await post(alice, once, to)).json()).toEqual({ error: "invalid_upload" });                                       // reuse
  });

  it("enforces the 30-minute cap and rejects malformed or oversized requests", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const to = [{ userId: bob.user, deviceId: bob.phone }];
    expect((await post(alice, await upload(alice), to, { durationSeconds: 1801 })).statusCode).toBe(400);
    expect((await post(alice, await upload(alice), to, { durationSeconds: 0 })).statusCode).toBe(400);
    expect((await post(alice, await upload(alice), to, { expiresInHours: 24 * 7 + 1 })).statusCode).toBe(400);
    expect((await post(alice, await upload(alice), to, { extra: "field" })).statusCode).toBe(400);                  // strict body
    expect((await post(alice, await upload(alice), [])).statusCode).toBe(400);                                       // nobody to send to
    expect((await post(alice, await upload(alice), to, { durationSeconds: 1800 })).statusCode).toBe(201);          // the cap itself is allowed
    const dup = await post(alice, await upload(alice), [...to, ...to]);
    expect(dup.statusCode).toBe(422);                                                                                  // same device twice
  });

  it("needs a device-bound token with the right scope", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const up = await upload(alice);
    const body = { attachmentId: up.id, durationSeconds: 60, ciphertextSize: up.size, recipients: [{ userId: bob.user, deviceId: bob.phone, sealedKey: "k" }] };
    expect((await call("POST", "/v1/status-videos", alice, "status:write", body, null)).statusCode).toBe(404);       // no device in the token
    expect((await call("POST", "/v1/status-videos", alice, "messages:read", body)).statusCode).toBeGreaterThanOrEqual(400); // wrong scope
    expect((await app.inject({ method: "GET", url: "/v1/status-videos/feed" })).statusCode).toBeGreaterThanOrEqual(400);   // no token
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:write")).statusCode).toBeGreaterThanOrEqual(400);    // viewers need status:react
  });

  it("a block placed after the post cuts the viewer off immediately", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const { id } = (await post(alice, await upload(alice), [{ userId: bob.user, deviceId: bob.phone }])).json();
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:react")).json().items).toHaveLength(1);
    await block(alice, bob);
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:react")).json().items).toEqual([]);
    expect((await call("POST", `/v1/status-videos/${id}/download`, bob, "status:react")).statusCode).toBe(404);
  });

  it("taking a post down revokes every key, deletes the ciphertext, and keeps an audit row", async () => {
    const alice = await person("alice"), bob = await person("bob"), carol = await person("carol");
    await befriend(alice, bob);
    const up = await upload(alice);
    const { id } = (await post(alice, up, [{ userId: alice.user, deviceId: alice.phone }, { userId: bob.user, deviceId: bob.phone }])).json();
    expect((await call("DELETE", `/v1/status-videos/${id}`, carol, "status:write")).statusCode).toBe(404); // only the owner
    expect((await call("DELETE", `/v1/status-videos/${id}`, bob, "status:write")).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/status-videos/${id}`, alice, "status:write")).statusCode).toBe(204);
    expect(deletedKeys).toEqual([up.key]);
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:react")).json().items).toEqual([]);
    expect((await call("POST", `/v1/status-videos/${id}/download`, bob, "status:react")).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/status-videos/${id}`, alice, "status:write")).statusCode).toBe(404); // already gone
    const keys = await db.query("SELECT count(*)::int AS n FROM status_video_recipients WHERE post_id=$1", [id]);
    expect(keys.rows[0].n).toBe(0);
    const audit = await db.query("SELECT deleted_at, owner_user_id FROM status_video_posts WHERE id=$1", [id]);
    expect(audit.rows[0].deleted_at).not.toBeNull();
    expect(audit.rows[0].owner_user_id).toBe(alice.user);
    const att = await db.query("SELECT status FROM attachment_uploads WHERE id=$1", [up.id]);
    expect(att.rows[0].status).toBe("DELETED");
  });

  it("expired posts disappear from every feed and are taken down by the retention job; a storage outage does not undo that", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const up = await upload(alice);
    const { id } = (await post(alice, up, [{ userId: bob.user, deviceId: bob.phone }], { expiresInHours: 1 })).json();
    await db.query("UPDATE status_video_posts SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id=$1", [id]);
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:react")).json().items).toEqual([]);           // hidden even before the job runs
    expect((await call("POST", `/v1/status-videos/${id}/download`, bob, "status:react")).statusCode).toBe(404);
    failDelete = true;
    expect(await service.expireDue()).toBeGreaterThanOrEqual(1);
    const row = await db.query("SELECT deleted_at FROM status_video_posts WHERE id=$1", [id]);
    expect(row.rows[0].deleted_at).not.toBeNull();
    expect((await db.query("SELECT count(*)::int AS n FROM status_video_recipients WHERE post_id=$1", [id])).rows[0].n).toBe(0);
    expect(await service.expireDue()).toBe(0);                                                                         // idempotent
  });

  it("a post under a retention hold is taken down for everyone but its ciphertext is kept for the investigation", async () => {
    const alice = await person("alice"), bob = await person("bob");
    await befriend(alice, bob);
    const up = await upload(alice);
    const { id } = (await post(alice, up, [{ userId: bob.user, deviceId: bob.phone }])).json();
    await db.query("INSERT INTO retention_overrides(resource_type,resource_id,reason,created_by) VALUES('STATUS_VIDEO',$1,'SAFETY_REPORT','test')", [id]);
    expect((await call("DELETE", `/v1/status-videos/${id}`, alice, "status:write")).statusCode).toBe(204);
    expect(deletedKeys).toEqual([]);                                                                                    // object kept
    expect((await db.query("SELECT status FROM attachment_uploads WHERE id=$1", [up.id])).rows[0].status).toBe("COMPLETE");
    expect((await call("GET", "/v1/status-videos/feed", bob, "status:react")).json().items).toEqual([]);             // but nobody can watch it
    expect((await call("POST", `/v1/status-videos/${id}/download`, bob, "status:react")).statusCode).toBe(404);
    expect((await db.query("SELECT count(*)::int AS n FROM status_video_recipients WHERE post_id=$1", [id])).rows[0].n).toBe(0);
  });

  it("the schema cannot hold a media key: the only key-like column is the sealed, per-device bundle", async () => {
    const cols = await db.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('status_video_posts','status_video_recipients') ORDER BY 1,2");
    const keyLike = cols.rows.filter((c) => /key|secret|nonce|token/i.test(c.column_name)).map((c) => `${c.table_name}.${c.column_name}`);
    expect(keyLike).toEqual(["status_video_recipients.sealed_key"]);
    const check = await db.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='status_video_posts'::regclass AND contype='c'");
    expect(check.rows.map((r) => r.def).join(" ")).toContain("1800");
  });
});
