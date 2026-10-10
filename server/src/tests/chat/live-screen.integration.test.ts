import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../../db/pool.js";
import { resolveDirectConversation } from "../../chat/chat.service.js";
import { LiveScreenService } from "../../chat/live-screen.service.js";

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;
const sealed = (n = 64, fill = 5) => Buffer.alloc(n, fill);

run("live screen share signaling", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = pool as unknown as Database;
  const screens = new LiveScreenService(db);
  const users: string[] = [];

  async function makeUser(name: string) {
    const id = randomUUID();
    await pool.query(`INSERT INTO users (id, external_subject, status, verified_country_code, country_verification_state) VALUES ($1,$2,'ACTIVE','US','VERIFIED')`, [id, `live-screen-${id}`]);
    await pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)`, [id, name]);
    users.push(id);
    return id;
  }
  async function chat() {
    const host = await makeUser("Host");
    const viewer = await makeUser("Viewer");
    const { conversationId } = await resolveDirectConversation(db, host, viewer);
    return { host, viewer, conversationId };
  }
  const state = async (id: string) => (await pool.query(`SELECT state, offer_envelope AS "offer", answer_envelope AS "answer" FROM live_screen_sessions WHERE id = $1`, [id])).rows[0];

  afterAll(async () => {
    if (users.length) {
      await pool.query(`DELETE FROM conversations WHERE created_by_user_id = ANY($1::uuid[])`, [users]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    }
    await pool.end();
  });

  it("offer, the viewer sees the offer, accepts with a sealed answer, the host receives it, and either side ends it with both envelopes erased", async () => {
    const { host, viewer, conversationId } = await chat();
    const id = randomUUID();
    expect(await screens.offer({ id, conversationId, userId: host, offerEnvelope: sealed(64, 1) })).toEqual({ id, state: "OFFERED", duplicate: false });
    const seenByViewer = await screens.current(viewer, conversationId);
    expect(seenByViewer).toMatchObject({ id, state: "OFFERED", hostUserId: host });
    expect(seenByViewer!.envelope!.equals(sealed(64, 1))).toBe(true);
    expect((await screens.current(host, conversationId))!.envelope).toBeNull(); // the host has no answer yet
    expect(await screens.answer({ id, userId: viewer, accept: true, answerEnvelope: sealed(64, 2) })).toEqual({ id, state: "ACTIVE" });
    expect((await screens.current(host, conversationId))!.envelope!.equals(sealed(64, 2))).toBe(true); // the host gets the answer
    expect((await screens.current(viewer, conversationId))!.envelope!.equals(sealed(64, 1))).toBe(true);
    expect(await screens.stop(id, viewer)).toEqual({ id, state: "STOPPED" }); // the viewer can leave
    expect(await state(id)).toMatchObject({ state: "STOPPED", offer: null, answer: null });
    expect(await screens.current(host, conversationId)).toBeNull();
  });

  it("declining ends it with no envelopes kept, and an answered or ended offer cannot be answered again", async () => {
    const { host, viewer, conversationId } = await chat();
    const id = randomUUID();
    await screens.offer({ id, conversationId, userId: host, offerEnvelope: sealed() });
    expect(await screens.answer({ id, userId: viewer, accept: false })).toEqual({ id, state: "DECLINED" });
    expect(await state(id)).toMatchObject({ state: "DECLINED", offer: null, answer: null });
    await expect(screens.answer({ id, userId: viewer, accept: true, answerEnvelope: sealed() })).rejects.toMatchObject({ code: "SCREEN_SESSION_NOT_FOUND" });
    await expect(screens.stop(id, host)).rejects.toMatchObject({ code: "SCREEN_SESSION_NOT_FOUND" });
  });

  it("the host cannot answer their own offer; a stranger cannot see, answer or stop anything", async () => {
    const { host, viewer, conversationId } = await chat();
    const stranger = await makeUser("Stranger");
    const id = randomUUID();
    await screens.offer({ id, conversationId, userId: host, offerEnvelope: sealed() });
    await expect(screens.answer({ id, userId: host, accept: true, answerEnvelope: sealed() })).rejects.toMatchObject({ code: "SCREEN_HOST_CANNOT_ANSWER" });
    await expect(screens.current(stranger, conversationId)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(screens.answer({ id, userId: stranger, accept: true, answerEnvelope: sealed() })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(screens.stop(id, stranger)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(screens.offer({ id: randomUUID(), conversationId, userId: stranger, offerEnvelope: sealed() })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect((await state(id)).state).toBe("OFFERED");
    void viewer;
  });

  it("accepting needs a sealed answer of a sensible size; offers must be sealed too", async () => {
    const { host, viewer, conversationId } = await chat();
    await expect(screens.offer({ id: randomUUID(), conversationId, userId: host, offerEnvelope: sealed(8) })).rejects.toMatchObject({ code: "SCREEN_OFFER_INVALID" });
    await expect(screens.offer({ id: randomUUID(), conversationId, userId: host, offerEnvelope: sealed(70_000) })).rejects.toMatchObject({ code: "SCREEN_OFFER_INVALID" });
    const id = randomUUID();
    await screens.offer({ id, conversationId, userId: host, offerEnvelope: sealed() });
    await expect(screens.answer({ id, userId: viewer, accept: true })).rejects.toMatchObject({ code: "SCREEN_ANSWER_INVALID" });
    await expect(screens.answer({ id, userId: viewer, accept: true, answerEnvelope: sealed(8) })).rejects.toMatchObject({ code: "SCREEN_ANSWER_INVALID" });
    expect((await state(id)).state).toBe("OFFERED");
  });

  it("only one share can be open in a conversation; repeating the same offer is a retry; someone else's id is refused", async () => {
    const { host, viewer, conversationId } = await chat();
    const id = randomUUID();
    await screens.offer({ id, conversationId, userId: host, offerEnvelope: sealed() });
    expect(await screens.offer({ id, conversationId, userId: host, offerEnvelope: sealed() })).toMatchObject({ duplicate: true });
    await expect(screens.offer({ id: randomUUID(), conversationId, userId: host, offerEnvelope: sealed() })).rejects.toMatchObject({ code: "SCREEN_SHARE_IN_PROGRESS" });
    await expect(screens.offer({ id: randomUUID(), conversationId, userId: viewer, offerEnvelope: sealed() })).rejects.toMatchObject({ code: "SCREEN_SHARE_IN_PROGRESS" });
    await expect(screens.offer({ id, conversationId, userId: viewer, offerEnvelope: sealed() })).rejects.toMatchObject({ code: "SCREEN_SESSION_ID_TAKEN" });
    await screens.stop(id, host);
    expect(await screens.offer({ id: randomUUID(), conversationId, userId: viewer, offerEnvelope: sealed() })).toMatchObject({ state: "OFFERED" }); // free again
  });

  it("an offer nobody answers lapses after five minutes, and a share that ran four hours is closed", async () => {
    const { host, viewer, conversationId } = await chat();
    const stale = randomUUID();
    await screens.offer({ id: stale, conversationId, userId: host, offerEnvelope: sealed() });
    await pool.query(`UPDATE live_screen_sessions SET created_at = now() - interval '6 minutes' WHERE id = $1`, [stale]);
    expect(await screens.current(viewer, conversationId)).toBeNull();
    expect(await state(stale)).toMatchObject({ state: "STOPPED", offer: null });
    await expect(screens.answer({ id: stale, userId: viewer, accept: true, answerEnvelope: sealed() })).rejects.toMatchObject({ code: "SCREEN_SESSION_NOT_FOUND" });

    const long = randomUUID();
    await screens.offer({ id: long, conversationId, userId: host, offerEnvelope: sealed() });
    await screens.answer({ id: long, userId: viewer, accept: true, answerEnvelope: sealed() });
    await pool.query(`UPDATE live_screen_sessions SET answered_at = now() - interval '5 hours' WHERE id = $1`, [long]);
    expect(await screens.current(host, conversationId)).toBeNull();
    expect(await state(long)).toMatchObject({ state: "STOPPED", offer: null, answer: null });
  });

  it("an unknown session is the same 404 for everyone", async () => {
    const { viewer } = await chat();
    await expect(screens.answer({ id: randomUUID(), userId: viewer, accept: false })).rejects.toMatchObject({ code: "SCREEN_SESSION_NOT_FOUND" });
    await expect(screens.stop(randomUUID(), viewer)).rejects.toMatchObject({ code: "SCREEN_SESSION_NOT_FOUND" });
  });
});
