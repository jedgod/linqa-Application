import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Database } from "../../db/pool.js";
import {
  ChatError,
  assertMember,
  hashQrToken,
  issueContactQrToken,
  listMessages,
  markConversationRead,
  redeemContactQrToken,
  resolveDirectConversation,
  sendMessage,
  withTransaction
} from "../../chat/chat.service.js";
import { publishOutboxBatch } from "../../chat/chat-outbox.service.js";
import { claimJobs } from "../../chat/chat-delivery.worker.js";
import { RealtimeHub } from "../../realtime/hub.js";
import { ensureTestDatabase, type TestDatabase } from "../support/test-database.js";

/**
 * Integration tests against a real PostgreSQL.
 *
 * The properties this pack cares about most -- idempotency under retry,
 * single-use QR redemption under concurrent scans, one-worker-per-job -- are
 * all enforced by SQL (unique indexes, `FOR UPDATE`, `SKIP LOCKED`). A stubbed
 * driver would assert that the code *calls* those statements, not that they
 * hold, so these run against the database or they do not run at all.
 *
 * The database comes from `DATABASE_URL` if one is set, otherwise from a
 * Testcontainers PostgreSQL started and migrated on demand. When neither is
 * available the suite skips rather than fails: a red build on a laptop without
 * Docker teaches people to ignore red builds.
 */
let db: Database;
let testDatabase: TestDatabase | null = null;
const createdUsers: string[] = [];

// Resolved before the suites are collected so `skipIf` sees a real answer.
testDatabase = await ensureTestDatabase();
const suite = testDatabase ? describe : describe.skip;

async function makeUser(name: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO users (id, external_subject, status) VALUES ($1,$2,'ACTIVE')`, [
    id,
    `chat-v2-test-${id}`
  ]);
  await db.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)`, [id, name]);
  createdUsers.push(id);
  return id;
}

const ciphertext = (text: string) => Buffer.from(text, "utf8").toString("base64");

function message(conversationId: string, senderUserId: string, clientMessageId = randomUUID()) {
  return {
    conversationId,
    senderUserId,
    senderDeviceId: undefined,
    clientMessageId,
    kind: "TEXT" as const,
    ciphertextBase64: ciphertext("hello"),
    mediaCount: 0,
    replyToId: undefined
  };
}

beforeAll(async () => {
  if (!testDatabase) return;
  db = new pg.Pool({ connectionString: testDatabase.connectionString, max: 12 }) as unknown as Database;
  // Container startup plus migrations comfortably exceeds the default timeout.
}, 180_000);

afterAll(async () => {
  if (!testDatabase) return;
  if (createdUsers.length) {
    // `conversations.created_by_user_id` has no ON DELETE CASCADE, so the
    // conversations go first; that cascade clears members, messages, direct
    // keys and outbox rows. Everything else keyed on the user cascades from
    // the user delete.
    await db.query(`DELETE FROM conversations WHERE created_by_user_id = ANY($1::uuid[])`, [createdUsers]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
  }
  await (db as unknown as pg.Pool).end();
  await testDatabase.stop();
}, 60_000);

suite("chat v2: direct conversation resolution", () => {
  it("collapses ten concurrent creates into one conversation", async () => {
    const alice = await makeUser("Alice Concurrent");
    const bob = await makeUser("Bob Concurrent");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => resolveDirectConversation(db, alice, bob))
    );

    // The advisory lock plus the unique key make first-contact idempotent even
    // when ten devices tap at once.
    expect(new Set(results.map((r) => r.conversationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("resolves the same conversation whichever side asks", async () => {
    const alice = await makeUser("Alice Order");
    const bob = await makeUser("Bob Order");

    const forward = await resolveDirectConversation(db, alice, bob);
    const reverse = await resolveDirectConversation(db, bob, alice);

    // Ordering is done by the database, so the pair maps to one row regardless
    // of who initiates -- and regardless of uuid text casing.
    expect(reverse.conversationId).toBe(forward.conversationId);
    expect(reverse.created).toBe(false);
  });

  it("refuses a conversation with yourself", async () => {
    const alice = await makeUser("Alice Solo");
    await expect(resolveDirectConversation(db, alice, alice)).rejects.toMatchObject({
      code: "SELF_CHAT_NOT_ALLOWED"
    });
  });
});

suite("chat v2: message idempotency and authorization", () => {
  it("returns one message for a retried send", async () => {
    const alice = await makeUser("Alice Retry");
    const bob = await makeUser("Bob Retry");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    const body = message(conversationId, alice);

    const [first, second] = await Promise.all([sendMessage(db, body), sendMessage(db, body)]);

    expect(first.id).toBe(second.id);
    const stored = await db.query(
      `SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id=$1 AND client_message_id=$2`,
      [conversationId, body.clientMessageId]
    );
    expect((stored.rows[0] as { n: number }).n).toBe(1);
    // Exactly one of the two attempts may emit the durable event.
    expect([first.duplicate, second.duplicate].filter(Boolean)).toHaveLength(1);
  });

  it("keeps one client id usable in two conversations", async () => {
    const alice = await makeUser("Alice Reuse");
    const bob = await makeUser("Bob Reuse");
    const carol = await makeUser("Carol Reuse");
    const withBob = await resolveDirectConversation(db, alice, bob);
    const withCarol = await resolveDirectConversation(db, alice, carol);
    const clientMessageId = randomUUID();

    const toBob = await sendMessage(db, message(withBob.conversationId, alice, clientMessageId));
    const toCarol = await sendMessage(db, message(withCarol.conversationId, alice, clientMessageId));

    // The pack keys idempotency on (sender, clientMessageId) alone, so the
    // second send would return Bob's message and then point Carol's
    // conversation at it -- leaking Bob's message into Carol's inbox.
    expect(toCarol.id).not.toBe(toBob.id);
    expect(toCarol.conversationId).toBe(withCarol.conversationId);
    expect(toCarol.duplicate).toBe(false);
  });

  it("refuses a message to a conversation the sender is not in", async () => {
    const alice = await makeUser("Alice Outsider");
    const bob = await makeUser("Bob Outsider");
    const stranger = await makeUser("Stranger");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);

    // 404, not 403: a 403 would confirm the conversation exists.
    await expect(sendMessage(db, message(conversationId, stranger))).rejects.toMatchObject({
      status: 404,
      code: "CONVERSATION_NOT_FOUND"
    });
  });

  it("refuses a message from a removed member", async () => {
    const alice = await makeUser("Alice Removed");
    const bob = await makeUser("Bob Removed");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    await db.query(
      `UPDATE conversation_members SET removed_at=now() WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, bob]
    );

    await expect(sendMessage(db, message(conversationId, bob))).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND"
    });
  });

  it("rejects a reply that points into another conversation", async () => {
    const alice = await makeUser("Alice Reply");
    const bob = await makeUser("Bob Reply");
    const carol = await makeUser("Carol Reply");
    const withBob = await resolveDirectConversation(db, alice, bob);
    const withCarol = await resolveDirectConversation(db, alice, carol);
    const inBob = await sendMessage(db, message(withBob.conversationId, alice));

    // Otherwise a crafted replyToId confirms that a message exists in a
    // conversation the sender cannot read.
    await expect(
      sendMessage(db, { ...message(withCarol.conversationId, alice), replyToId: inBob.id })
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a body that is not valid base64", async () => {
    const alice = await makeUser("Alice Base64");
    const bob = await makeUser("Bob Base64");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);

    await expect(
      sendMessage(db, { ...message(conversationId, alice), ciphertextBase64: "not base64 !!!" })
    ).rejects.toMatchObject({ code: "CIPHERTEXT_NOT_BASE64" });
  });

  it("stores no plaintext column for a message body", async () => {
    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='chat_messages'`
    );
    const names = (columns.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    // Linqa is end-to-end encrypted; a server-readable body column would
    // quietly create a second, plaintext message path.
    expect(names).toContain("body_ciphertext");
    expect(names).not.toContain("body_text");
  });
});

suite("chat v2: read state", () => {
  it("clears unread and records where the member read to", async () => {
    const alice = await makeUser("Alice Read");
    const bob = await makeUser("Bob Read");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    const sent = await sendMessage(db, message(conversationId, alice));

    const before = await db.query(
      `SELECT unread_count AS n FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, bob]
    );
    expect((before.rows[0] as { n: number }).n).toBe(1);

    const result = await markConversationRead(db, bob, conversationId);
    expect(result.lastReadMessageId).toBe(sent.id);

    const after = await db.query(
      `SELECT unread_count AS n, last_read_message_id AS "lastRead"
         FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, bob]
    );
    expect((after.rows[0] as { n: number }).n).toBe(0);
    expect((after.rows[0] as { lastRead: string }).lastRead).toBe(sent.id);
  });

  it("does not wipe the read pointer for a conversation with no messages", async () => {
    const alice = await makeUser("Alice Empty");
    const bob = await makeUser("Bob Empty");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    const sent = await sendMessage(db, message(conversationId, alice));
    await markConversationRead(db, bob, conversationId);

    // Soft-delete the only message, then read again.
    await db.query(`UPDATE chat_messages SET deleted_at=now() WHERE id=$1`, [sent.id]);
    await markConversationRead(db, bob, conversationId);

    const after = await db.query(
      `SELECT last_read_message_id AS "lastRead" FROM conversation_members
        WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, bob]
    );
    // The pack writes NULL here, silently discarding read state.
    expect((after.rows[0] as { lastRead: string | null }).lastRead).toBe(sent.id);
  });

  it("does not let a stale request move the pointer backwards", async () => {
    const alice = await makeUser("Alice Backwards");
    const bob = await makeUser("Bob Backwards");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    await sendMessage(db, message(conversationId, alice));
    await markConversationRead(db, bob, conversationId);
    const firstRead = await db.query(
      `SELECT last_read_at AS "at" FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, bob]
    );

    await markConversationRead(db, bob, conversationId);
    const secondRead = await db.query(
      `SELECT last_read_at AS "at" FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, bob]
    );
    expect(new Date((secondRead.rows[0] as { at: Date }).at).getTime()).toBeGreaterThanOrEqual(
      new Date((firstRead.rows[0] as { at: Date }).at).getTime()
    );
  });
});

suite("chat v2: message paging", () => {
  it("pages newest-first without repeating or skipping", async () => {
    const alice = await makeUser("Alice Page");
    const bob = await makeUser("Bob Page");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    for (let i = 0; i < 7; i += 1) {
      await sendMessage(db, message(conversationId, alice));
    }

    const first = await listMessages(db, alice, conversationId, 3);
    const second = await listMessages(db, alice, conversationId, 3, first.nextCursor ?? undefined);
    const ids = [...first.messages, ...second.messages].map((m) => (m as { id: string }).id);

    expect(first.messages).toHaveLength(3);
    expect(second.messages).toHaveLength(3);
    expect(new Set(ids).size).toBe(6);
  });

  it("refuses paging a conversation the caller is not in", async () => {
    const alice = await makeUser("Alice Private");
    const bob = await makeUser("Bob Private");
    const stranger = await makeUser("Stranger Private");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);

    await expect(listMessages(db, stranger, conversationId, 10)).rejects.toMatchObject({
      status: 404
    });
  });

  it("rejects a malformed cursor instead of returning the first page", async () => {
    const alice = await makeUser("Alice Cursor");
    const bob = await makeUser("Bob Cursor");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);

    await expect(listMessages(db, alice, conversationId, 10, "@@@not-a-cursor@@@")).rejects.toMatchObject(
      { code: "INVALID_CURSOR" }
    );
  });
});

suite("chat v2: QR contact exchange", () => {
  it("redeems a single-use token exactly once under concurrency", async () => {
    const alice = await makeUser("Alice QR");
    const bob = await makeUser("Bob QR");
    const carol = await makeUser("Carol QR");
    const { token } = await issueContactQrToken(db, alice, 300);

    const results = await Promise.allSettled([
      redeemContactQrToken(db, bob, token),
      redeemContactQrToken(db, carol, token)
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as ChatError).code).toBe("QR_INVALID_OR_EXPIRED");
  });

  it("creates the contact in both directions", async () => {
    const alice = await makeUser("Alice Mutual");
    const bob = await makeUser("Bob Mutual");
    const { token } = await issueContactQrToken(db, alice, 300);
    await redeemContactQrToken(db, bob, token);

    const rows = await db.query(
      `SELECT count(*)::int AS n FROM chat_contacts
        WHERE (owner_user_id=$1 AND contact_user_id=$2) OR (owner_user_id=$2 AND contact_user_id=$1)`,
      [alice, bob]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(2);
  });

  it("refuses an expired token", async () => {
    const alice = await makeUser("Alice Expired");
    const bob = await makeUser("Bob Expired");
    const { token } = await issueContactQrToken(db, alice, 300);
    await db.query(`UPDATE contact_qr_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash=$1`, [
      hashQrToken(token)
    ]);

    await expect(redeemContactQrToken(db, bob, token)).rejects.toMatchObject({
      status: 410,
      code: "QR_INVALID_OR_EXPIRED"
    });
  });

  it("retires the previous code when a new one is issued", async () => {
    const alice = await makeUser("Alice Rotate");
    const bob = await makeUser("Bob Rotate");
    const first = await issueContactQrToken(db, alice, 300);
    await issueContactQrToken(db, alice, 300);

    // Showing a fresh QR has to actually withdraw the old one, or every code a
    // user ever displayed stays redeemable until it expires.
    await expect(redeemContactQrToken(db, bob, first.token)).rejects.toMatchObject({
      code: "QR_INVALID_OR_EXPIRED"
    });
  });

  it("refuses redeeming your own code", async () => {
    const alice = await makeUser("Alice Self QR");
    const { token } = await issueContactQrToken(db, alice, 300);
    await expect(redeemContactQrToken(db, alice, token)).rejects.toMatchObject({ code: "QR_SELF_REDEEM" });
  });

  it("gives the same answer for an unknown token as for an expired one", async () => {
    const bob = await makeUser("Bob Unknown QR");
    await expect(redeemContactQrToken(db, bob, "totally-made-up-token-value")).rejects.toMatchObject({
      status: 410,
      code: "QR_INVALID_OR_EXPIRED"
    });
  });
});

suite("chat v2: outbox and workers", () => {
  it("publishes each event once across concurrent relays", async () => {
    const alice = await makeUser("Alice Outbox");
    const bob = await makeUser("Bob Outbox");
    const { conversationId } = await resolveDirectConversation(db, alice, bob);
    await sendMessage(db, message(conversationId, alice));

    const hub = new RealtimeHub();
    const [a, b, c] = await Promise.all([
      publishOutboxBatch(db, hub, 50),
      publishOutboxBatch(db, hub, 50),
      publishOutboxBatch(db, hub, 50)
    ]);

    const unpublished = await db.query(
      `SELECT count(*)::int AS n FROM chat_outbox WHERE conversation_id=$1 AND published_at IS NULL`,
      [conversationId]
    );
    expect((unpublished.rows[0] as { n: number }).n).toBe(0);
    // SKIP LOCKED divides the batch; it never hands one row to two relays.
    expect(a + b + c).toBeGreaterThanOrEqual(1);
  });

  it("lets only one worker claim a due job", async () => {
    const dedupeKey = `test-job-${randomUUID()}`;
    await db.query(
      `INSERT INTO chat_delivery_jobs (job_type, dedupe_key, payload) VALUES ('call.reminder',$1,'{}'::jsonb)`,
      [dedupeKey]
    );

    const claims = (await Promise.all([claimJobs(db, 10), claimJobs(db, 10), claimJobs(db, 10)])).flat();

    const mine = claims.filter((job) => job.jobType === "call.reminder");
    const ids = new Set(mine.map((job) => job.id));
    expect(ids.size).toBe(mine.length);
    await db.query(`DELETE FROM chat_delivery_jobs WHERE dedupe_key=$1`, [dedupeKey]);
  });

  it("refuses a duplicate job dedupe key", async () => {
    const dedupeKey = `test-dupe-${randomUUID()}`;
    await db.query(
      `INSERT INTO chat_delivery_jobs (job_type, dedupe_key, payload) VALUES ('call.reminder',$1,'{}'::jsonb)`,
      [dedupeKey]
    );
    const second = await db.query(
      `INSERT INTO chat_delivery_jobs (job_type, dedupe_key, payload) VALUES ('call.reminder',$1,'{}'::jsonb)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [dedupeKey]
    );
    expect(second.rowCount).toBe(0);
    await db.query(`DELETE FROM chat_delivery_jobs WHERE dedupe_key=$1`, [dedupeKey]);
  });
});

suite("chat v2: transaction safety", () => {
  it("reports the original failure, not the rollback's", async () => {
    // The pack rolls back unguarded in its catch, so a second failure there
    // replaces the cause and the real error never surfaces.
    await expect(
      withTransaction(db, async () => {
        throw new ChatError(418, "ORIGINAL_CAUSE");
      })
    ).rejects.toMatchObject({ code: "ORIGINAL_CAUSE" });
  });

  it("rolls back every write when the unit of work fails", async () => {
    const alice = await makeUser("Alice Rollback");
    const marker = randomUUID();
    await expect(
      withTransaction(db, async (client) => {
        await client.query(
          `INSERT INTO chat_security_audit (actor_user_id, action, resource_type, request_id)
           VALUES ($1,'test.rollback','test',$2)`,
          [alice, marker]
        );
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const rows = await db.query(`SELECT count(*)::int AS n FROM chat_security_audit WHERE request_id=$1`, [
      marker
    ]);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("answers 404 from assertMember for a conversation that does not exist", async () => {
    const alice = await makeUser("Alice Missing");
    await expect(
      withTransaction(db, (client) => assertMember(client, alice, randomUUID()))
    ).rejects.toMatchObject({ status: 404 });
  });
});
