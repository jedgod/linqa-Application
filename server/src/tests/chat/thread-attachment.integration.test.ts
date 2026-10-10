import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../../db/pool.js";
import { resolveDirectConversation, setDisappearAfter } from "../../chat/chat.service.js";
import { ThreadAttachmentService } from "../../chat/thread-attachment.service.js";

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;

const sealed = (n = 64) => Buffer.alloc(n, 7);

run("encrypted thread attachments and location sharing", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = pool as unknown as Database;
  const service = new ThreadAttachmentService(db);
  const users: string[] = [];

  async function makeUser(name: string) {
    const id = randomUUID();
    await pool.query(`INSERT INTO users (id, external_subject, status, verified_country_code, country_verification_state) VALUES ($1,$2,'ACTIVE','US','VERIFIED')`, [id, `thread-att-${id}`]);
    await pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)`, [id, name]);
    users.push(id);
    return id;
  }
  async function chat() {
    const a = await makeUser("Alice Att");
    const b = await makeUser("Bob Att");
    const { conversationId } = await resolveDirectConversation(db, a, b);
    return { a, b, conversationId };
  }

  afterAll(async () => {
    if (users.length) {
      await pool.query(`DELETE FROM conversations WHERE created_by_user_id = ANY($1::uuid[])`, [users]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    }
    await pool.end();
  });

  it("stores encrypted media only for members; retries cannot overwrite bytes", async () => {
    const { a, b, conversationId } = await chat(); const id = randomUUID();
    await service.storeMedia({ id, conversationId, userId: a, envelope: sealed(128) });
    expect((await service.readMedia(b,conversationId,id)).equals(sealed(128))).toBe(true);
    await expect(service.storeMedia({ id,conversationId,userId:a,envelope:sealed(128) })).resolves.toEqual({id});
    await expect(service.storeMedia({ id,conversationId,userId:b,envelope:sealed(128) })).rejects.toMatchObject({code:"MEDIA_ID_TAKEN"});
    await expect(service.storeMedia({ id,conversationId,userId:a,envelope:sealed(129) })).rejects.toMatchObject({code:"MEDIA_ID_TAKEN"});
    const outsider = await makeUser("Media outsider");
    await expect(service.readMedia(outsider,conversationId,id)).rejects.toBeDefined();
    await expect(service.storeMedia({id:randomUUID(),conversationId,userId:outsider,envelope:sealed()})).rejects.toBeDefined();
  });
  it("rejects uploads from a device that is not active for the sender", async () => {
    const { a, conversationId } = await chat();
    await expect(service.storeMedia({ id: randomUUID(), conversationId, userId: a, deviceId: randomUUID(), envelope: sealed() })).rejects.toMatchObject({ code: "DEVICE_REQUIRED" });
  });
  it("rejects oversized encrypted media and hides expired files", async () => {
    const { a, b, conversationId } = await chat(); const id = randomUUID();
    await expect(service.storeMedia({id,conversationId,userId:a,envelope:sealed(25*1024*1024+41)})).rejects.toMatchObject({code:"MEDIA_TOO_LARGE"});
    await expect(service.storeMedia({id,conversationId,userId:a,envelope:sealed(10)})).rejects.toMatchObject({code:"MEDIA_TOO_LARGE"});
    await service.storeMedia({id,conversationId,userId:a,envelope:sealed()});
    await pool.query("UPDATE conversation_media SET expires_at=now()-interval '1 second' WHERE id=$1",[id]);
    await expect(service.readMedia(b,conversationId,id)).rejects.toMatchObject({code:"MEDIA_NOT_FOUND"});
  });

  it("stores a sealed attachment for a member and lists it for the other member, newest first", async () => {
    const { a, b, conversationId } = await chat();
    const first = randomUUID(); const second = randomUUID();
    expect(await service.accept({ id: first, conversationId, userId: a, kind: "EVENT", envelope: sealed() })).toEqual({ id: first, accepted: true, duplicate: false });
    await service.accept({ id: second, conversationId, userId: a, kind: "MEETING", envelope: sealed(80) });
    const rows = await service.list(b, conversationId);
    expect(rows.map((r) => r.id)).toEqual([second, first]);
    expect(rows[0]!.kind).toBe("MEETING");
    expect(rows[0]!.envelope.equals(sealed(80))).toBe(true); // bytes come back exactly as stored
    // The server holds opaque bytes and nothing it could read.
    const raw = await pool.query(`SELECT byte_length FROM thread_attachments WHERE id = $1`, [first]);
    expect(raw.rows[0].byte_length).toBe(64);
  });

  it("is idempotent for the sender, and an id cannot be taken over by someone else", async () => {
    const { a, b, conversationId } = await chat();
    const id = randomUUID();
    await service.accept({ id, conversationId, userId: a, kind: "EVENT", envelope: sealed() });
    expect(await service.accept({ id, conversationId, userId: a, kind: "EVENT", envelope: sealed() })).toMatchObject({ duplicate: true });
    await expect(service.accept({ id, conversationId, userId: b, kind: "EVENT", envelope: sealed() })).rejects.toMatchObject({ code: "ATTACHMENT_ID_TAKEN" });
    await expect(service.accept({ id, conversationId, userId: a, kind: "EVENT", envelope: sealed(80) })).rejects.toMatchObject({ code: "ATTACHMENT_ID_TAKEN" });
    await expect(service.accept({ id, conversationId, userId: a, kind: "CONTACT", envelope: sealed() })).rejects.toMatchObject({ code: "ATTACHMENT_ID_TAKEN" });
    expect((await service.list(a, conversationId)).length).toBe(1);
  });

  it("refuses non-members, tiny or huge envelopes", async () => {
    const { a, conversationId } = await chat();
    const outsider = await makeUser("Outsider");
    await expect(service.accept({ id: randomUUID(), conversationId, userId: outsider, kind: "EVENT", envelope: sealed() })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(service.list(outsider, conversationId)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(service.accept({ id: randomUUID(), conversationId, userId: a, kind: "EVENT", envelope: sealed(8) })).rejects.toMatchObject({ code: "ATTACHMENT_ENVELOPE_INVALID" });
    await expect(service.accept({ id: randomUUID(), conversationId, userId: a, kind: "EVENT", envelope: sealed(300_000) })).rejects.toMatchObject({ code: "ATTACHMENT_ENVELOPE_INVALID" });
  });

  it("follows disappearing messages: stamped with an expiry, hidden once expired, deleted on the next add", async () => {
    const { a, conversationId } = await chat();
    const before = randomUUID();
    await service.accept({ id: before, conversationId, userId: a, kind: "EVENT", envelope: sealed() });
    await setDisappearAfter(db, a, conversationId, 86_400);
    const later = randomUUID();
    await service.accept({ id: later, conversationId, userId: a, kind: "EVENT", envelope: sealed() });
    const stamps = await pool.query(`SELECT id, expires_at FROM thread_attachments WHERE id = ANY($1::uuid[])`, [[before, later]]);
    const byId = Object.fromEntries(stamps.rows.map((r: { id: string; expires_at: Date | null }) => [r.id, r.expires_at]));
    expect(byId[before]).toBeNull();           // sent before the setting: keeps no expiry
    expect(byId[later]).not.toBeNull();
    await pool.query(`UPDATE thread_attachments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [later]);
    expect((await service.list(a, conversationId)).map((r) => r.id)).toEqual([before]);
    await service.accept({ id: randomUUID(), conversationId, userId: a, kind: "EVENT", envelope: sealed() });
    expect((await pool.query(`SELECT 1 FROM thread_attachments WHERE id = $1`, [later])).rowCount).toBe(0);
  });

  describe("location sharing", () => {
    const future = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    it("request, accept with a sealed envelope, the other member sees it, owner stops it and the envelope is erased", async () => {
      const { a, b, conversationId } = await chat();
      const id = randomUUID();
      expect(await service.requestLocation({ id, conversationId, userId: a, peerUserId: b })).toEqual({ id, state: "REQUESTED" });
      let shares = await service.locationShares(b, conversationId);
      expect(shares).toHaveLength(1);
      expect(shares[0]).toMatchObject({ state: "REQUESTED", ownerUserId: b, requestedBy: a, envelope: null });
      expect(await service.answerLocation({ id, userId: b, accept: true, envelope: sealed(), expiresAt: future(30) })).toEqual({ id, state: "SHARING" });
      shares = await service.locationShares(a, conversationId);
      expect(shares[0]!.state).toBe("SHARING");
      expect(shares[0]!.envelope!.equals(sealed())).toBe(true);
      await expect(service.stopLocation(id, a)).rejects.toMatchObject({ code: "LOCATION_SHARE_NOT_FOUND" }); // only the owner can stop
      expect(await service.stopLocation(id, b)).toEqual({ id, state: "STOPPED" });
      const raw = await pool.query(`SELECT state, envelope FROM location_shares WHERE id = $1`, [id]);
      expect(raw.rows[0]).toMatchObject({ state: "STOPPED", envelope: null });
      expect(await service.locationShares(a, conversationId)).toEqual([]);
    });

    it("declining stores no coordinates; the requester and strangers cannot answer", async () => {
      const { a, b, conversationId } = await chat();
      const stranger = await makeUser("Stranger");
      const id = randomUUID();
      await service.requestLocation({ id, conversationId, userId: a, peerUserId: b });
      await expect(service.answerLocation({ id, userId: a, accept: true, envelope: sealed(), expiresAt: future(10) })).rejects.toMatchObject({ code: "LOCATION_SHARE_NOT_FOUND" });
      await expect(service.answerLocation({ id, userId: stranger, accept: false })).rejects.toMatchObject({ code: "LOCATION_SHARE_NOT_FOUND" });
      expect(await service.answerLocation({ id, userId: b, accept: false })).toEqual({ id, state: "DECLINED" });
      await expect(service.answerLocation({ id, userId: b, accept: true, envelope: sealed(), expiresAt: future(10) })).rejects.toMatchObject({ code: "LOCATION_SHARE_NOT_FOUND" }); // already answered
    });

    it("accepting needs an envelope and an end time that is in the future and at most eight hours away", async () => {
      const { a, b, conversationId } = await chat();
      const id = randomUUID();
      await service.requestLocation({ id, conversationId, userId: a, peerUserId: b });
      await expect(service.answerLocation({ id, userId: b, accept: true, expiresAt: future(10) })).rejects.toMatchObject({ code: "LOCATION_ENVELOPE_REQUIRED" });
      await expect(service.answerLocation({ id, userId: b, accept: true, envelope: sealed() })).rejects.toMatchObject({ code: "LOCATION_EXPIRY_INVALID" });
      await expect(service.answerLocation({ id, userId: b, accept: true, envelope: sealed(), expiresAt: future(-5) })).rejects.toMatchObject({ code: "LOCATION_EXPIRY_INVALID" });
      await expect(service.answerLocation({ id, userId: b, accept: true, envelope: sealed(), expiresAt: future(9 * 60) })).rejects.toMatchObject({ code: "LOCATION_EXPIRY_INVALID" });
      expect((await pool.query(`SELECT state FROM location_shares WHERE id = $1`, [id])).rows[0].state).toBe("REQUESTED");
    });

    it("cannot ask yourself, someone outside the conversation, or twice while a request is open", async () => {
      const { a, b, conversationId } = await chat();
      const outsider = await makeUser("Outsider2");
      await expect(service.requestLocation({ id: randomUUID(), conversationId, userId: a, peerUserId: a })).rejects.toMatchObject({ code: "LOCATION_REQUEST_SELF" });
      await expect(service.requestLocation({ id: randomUUID(), conversationId, userId: a, peerUserId: outsider })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
      await expect(service.requestLocation({ id: randomUUID(), conversationId, userId: outsider, peerUserId: b })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
      await service.requestLocation({ id: randomUUID(), conversationId, userId: a, peerUserId: b });
      await expect(service.requestLocation({ id: randomUUID(), conversationId, userId: a, peerUserId: b })).rejects.toMatchObject({ code: "LOCATION_REQUEST_PENDING" });
    });

    it("sharing that has run out is closed and its envelope erased when anyone looks", async () => {
      const { a, b, conversationId } = await chat();
      const id = randomUUID();
      await service.requestLocation({ id, conversationId, userId: a, peerUserId: b });
      await service.answerLocation({ id, userId: b, accept: true, envelope: sealed(), expiresAt: future(30) });
      await pool.query(`UPDATE location_shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
      expect(await service.locationShares(a, conversationId)).toEqual([]);
      expect((await pool.query(`SELECT state, envelope FROM location_shares WHERE id = $1`, [id])).rows[0]).toMatchObject({ state: "STOPPED", envelope: null });
    });
  });
});
