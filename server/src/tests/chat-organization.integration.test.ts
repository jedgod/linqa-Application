import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Database } from "../db/pool.js";
import { ChatError } from "../chat/chat.service.js";
import {
  LIMITS, addGroupMembers, createChatList, createGroup, deleteChatList, listChatLists, renameChatList, setChatInList, setConversationArchived
} from "../chat-organization/chat-organization.service.js";
import { ensureTestDatabase, type TestDatabase } from "./support/test-database.js";

/** Against a real PostgreSQL: ownership and the contact rule live in SQL. */
let db: Database;
let testDatabase: TestDatabase | null = null;
testDatabase = await ensureTestDatabase();
const suite = testDatabase ? describe : describe.skip;

const userIds: string[] = [];
async function makeUser() {
  const id = randomUUID();
  await db.query(`INSERT INTO users (id, external_subject, status) VALUES ($1,$2,'ACTIVE')`, [id, `org-test-${id}`]);
  userIds.push(id);
  return id;
}
async function direct(a: string, b: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO conversations (id, conversation_type, created_by_user_id, display_title) VALUES ($1,'DIRECT',$2,'x')`, [id, a]);
  await db.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'OWNER'), ($1,$3,'MEMBER')`, [id, a, b]);
  return id;
}
const code = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (e) { return e instanceof ChatError ? e.code : String(e); } };

beforeAll(async () => {
  if (!testDatabase) return;
  db = new pg.Pool({ connectionString: testDatabase.connectionString, max: 6 }) as unknown as Database;
});
afterAll(async () => {
  if (!testDatabase) return;
  if (userIds.length) {
    await db.query(`DELETE FROM conversations WHERE created_by_user_id = ANY($1::uuid[])`, [userIds]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  }
  await (db as unknown as pg.Pool).end();
  await testDatabase.stop?.();
});

suite("organizing chats", () => {
  it("creates, renames, counts and deletes lists; names are unique per person", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    const work = await createChatList(db, me, "  Work  ", "blue");
    expect(work).toMatchObject({ name: "Work", color: "blue", count: 0 });
    expect(await code(createChatList(db, me, "work"))).toBe("LIST_EXISTS");
    expect((await createChatList(db, other, "Work")).name).toBe("Work"); // another person may use the same name
    await setChatInList(db, me, work.id, chat, true);
    expect((await listChatLists(db, me))[0]!.count).toBe(1);
    await renameChatList(db, me, work.id, "Office");
    expect((await listChatLists(db, me))[0]!.name).toBe("Office");
    await setChatInList(db, me, work.id, chat, false);
    expect((await listChatLists(db, me))[0]!.count).toBe(0);
    await deleteChatList(db, me, work.id);
    expect(await listChatLists(db, me)).toEqual([]);
  });

  it("someone else's list or chat cannot be touched", async () => {
    const me = await makeUser();
    const stranger = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    const mine = await createChatList(db, me, "Mine");
    const theirs = await createChatList(db, stranger, "Theirs");
    expect(await code(setChatInList(db, stranger, mine.id, chat, true))).toBe("LIST_NOT_FOUND");
    expect(await code(setChatInList(db, stranger, theirs.id, chat, true))).toBe("CONVERSATION_NOT_FOUND");
    expect(await code(renameChatList(db, stranger, mine.id, "Hijack"))).toBe("LIST_NOT_FOUND");
    expect(await code(deleteChatList(db, stranger, mine.id))).toBe("LIST_NOT_FOUND");
  });

  it("limits the number of lists and rejects empty or long names", async () => {
    const me = await makeUser();
    expect(await code(createChatList(db, me, "   "))).toBe("INVALID_LIST_NAME");
    expect(await code(createChatList(db, me, "x".repeat(LIMITS.listName + 1)))).toBe("INVALID_LIST_NAME");
    for (let i = 0; i < LIMITS.lists; i += 1) await createChatList(db, me, `L${i}`);
    expect(await code(createChatList(db, me, "One too many"))).toBe("TOO_MANY_LISTS");
  });

  it("archiving is personal", async () => {
    const me = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    await setConversationArchived(db, me, chat, true);
    const rows = await db.query(`SELECT user_id, archived_at IS NOT NULL AS archived FROM conversation_members WHERE conversation_id = $1`, [chat]);
    const byUser = new Map((rows.rows as Array<{ user_id: string; archived: boolean }>).map((r) => [r.user_id, r.archived]));
    expect(byUser.get(me)).toBe(true);
    expect(byUser.get(peer)).toBe(false);
    await setConversationArchived(db, me, chat, false);
    expect((await db.query(`SELECT archived_at FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [chat, me])).rows[0].archived_at).toBeNull();
    expect(await code(setConversationArchived(db, await makeUser(), chat, true))).toBe("CONVERSATION_NOT_FOUND");
  });

  it("a group can include only people you already chat with, and not blocked ones", async () => {
    const me = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const stranger = await makeUser();
    await direct(me, a);
    await direct(me, b);
    expect(await code(createGroup(db, me, "Team", [a, stranger]))).toBe("NOT_A_CONTACT");
    expect(await code(createGroup(db, me, "Team", [me]))).toBe("INVALID_MEMBERS");
    expect(await code(createGroup(db, me, "  ", [a]))).toBe("INVALID_GROUP_TITLE");
    await db.query(`INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)`, [b, me]);
    expect(await code(createGroup(db, me, "Team", [b]))).toBe("NOT_A_CONTACT");
    const { conversationId } = await createGroup(db, me, "Team", [a, a]);
    const members = await db.query(`SELECT user_id, role FROM conversation_members WHERE conversation_id = $1 ORDER BY role`, [conversationId]);
    expect(members.rows).toHaveLength(2);
    expect((await db.query(`SELECT conversation_type FROM conversations WHERE id=$1`, [conversationId])).rows[0].conversation_type).toBe("GROUP");
  });

  it("only an owner or admin adds people to a group, and only to groups", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const friend = await makeUser();
    await direct(owner, member);
    await direct(owner, friend);
    await direct(member, friend);
    const { conversationId } = await createGroup(db, owner, "Crew", [member]);
    expect(await code(addGroupMembers(db, member, conversationId, [friend]))).toBe("NOT_ALLOWED");
    expect(await addGroupMembers(db, owner, conversationId, [friend, member])).toEqual({ added: 1 });
    expect(await addGroupMembers(db, owner, conversationId, [friend])).toEqual({ added: 0 });
    const chat = await direct(owner, member);
    expect(await code(addGroupMembers(db, owner, chat, [friend]))).toBe("NOT_A_GROUP");
  });
});

import { chatControls, clearChat, deleteChat, reportChat } from "../chat-organization/chat-controls.service.js";
import { listMessages, sendMessage } from "../chat/chat.service.js";

suite("chat controls", () => {
  const say = (conversationId: string, senderUserId: string, text: string) =>
    sendMessage(db, { conversationId, senderUserId, senderDeviceId: undefined, clientMessageId: randomUUID(), kind: "TEXT", ciphertextBase64: Buffer.from(text).toString("base64"), mediaCount: 0, replyToId: undefined });
  const texts = async (conversationId: string, userId: string) =>
    ((await listMessages(db, userId, conversationId, 50)).messages as Array<{ ciphertext: string }>).map((m) => Buffer.from(m.ciphertext, "base64").toString());

  it("reports who the chat is with and its settings, only to a member", async () => {
    const me = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    const info = await chatControls(db, me, chat);
    expect(info).toMatchObject({ conversationId: chat, isGroup: false, muted: false, pinned: false, archived: false, disappearAfterSeconds: null });
    expect(info.peer?.userId).toBe(peer);
    expect(info.peer?.blockedByMe).toBe(false);
    // A direct chat lists both people too: phones seal each message for everyone in this list.
    expect(info.members.map((m) => m.userId).sort()).toEqual([me, peer].sort());
    expect(await code(chatControls(db, await makeUser(), chat))).toBe("CONVERSATION_NOT_FOUND");
  });

  it("clearing hides earlier messages for one person only; later ones still arrive", async () => {
    const me = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    await say(chat, peer, "before");
    await new Promise((r) => setTimeout(r, 30));
    await clearChat(db, me, chat);
    expect(await texts(chat, me)).toEqual([]);
    expect(await texts(chat, peer)).toEqual(["before"]);
    await new Promise((r) => setTimeout(r, 30));
    await say(chat, peer, "after");
    expect(await texts(chat, me)).toEqual(["after"]);
  });

  it("deleting also clears, drops the chat from lists and favorites, and leaves the other person's copy", async () => {
    const me = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    const list = await createChatList(db, me, "Temp");
    await setChatInList(db, me, list.id, chat, true);
    await db.query(`UPDATE conversation_members SET pinned = TRUE WHERE conversation_id = $1 AND user_id = $2`, [chat, me]);
    await say(chat, me, "hello");
    await new Promise((r) => setTimeout(r, 30));
    await deleteChat(db, me, chat);
    const mine = (await db.query(`SELECT pinned, hidden_at IS NOT NULL AS hidden FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [chat, me])).rows[0];
    expect(mine).toMatchObject({ pinned: false, hidden: true });
    expect((await listChatLists(db, me))[0]!.count).toBe(0);
    expect(await texts(chat, me)).toEqual([]);
    expect(await texts(chat, peer)).toEqual(["hello"]);
  });

  it("a report needs a real description and names the other person", async () => {
    const me = await makeUser();
    const peer = await makeUser();
    const chat = await direct(me, peer);
    expect(await code(reportChat(db, me, chat, "SCAM", "short"))).toBe("DESCRIPTION_TOO_SHORT");
    const made = await reportChat(db, me, chat, "SCAM", "They asked me to send money to a stranger.");
    const row = (await db.query(`SELECT reported_user_id, category FROM safety_reports WHERE id = $1`, [made.id])).rows[0];
    expect(row).toMatchObject({ reported_user_id: peer, category: "SCAM" });
    await db.query(`DELETE FROM safety_reports WHERE id = $1`, [made.id]);
  });
});
