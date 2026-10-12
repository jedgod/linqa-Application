import type { Database } from "../db/pool.js";
import { ChatError, assertMember, withTransaction } from "../chat/chat.service.js";

/**
 * How a person organizes their chats: lists, the archive, and shared groups. Favorites use the existing `pinned` flag.
 * Lists and the archive belong to one person; a group is a shared conversation.
 */
export const LIMITS = { lists: 20, groupOthers: 4, groupTitle: 60, listName: 40 } as const;
export const LIST_COLORS = ["violet", "blue", "green", "orange", "red", "teal"] as const;
export type ListColor = (typeof LIST_COLORS)[number];

export interface ChatList { id: string; name: string; color: ListColor; count: number }

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

export async function listChatLists(db: Database, userId: string): Promise<ChatList[]> {
  const result = await db.query(
    `SELECT l.id, l.name, l.color,
            (SELECT count(*)::int FROM chat_list_items i
               JOIN conversation_members cm ON cm.conversation_id = i.conversation_id AND cm.user_id = $1 AND cm.removed_at IS NULL AND cm.archived_at IS NULL
              WHERE i.list_id = l.id) AS count
       FROM chat_lists l WHERE l.user_id = $1 ORDER BY l.created_at`,
    [userId]
  );
  return result.rows as ChatList[];
}

export async function createChatList(db: Database, userId: string, name: string, color: ListColor = "violet"): Promise<ChatList> {
  const trimmed = clean(name);
  if (trimmed.length < 1 || trimmed.length > LIMITS.listName) throw new ChatError(422, "INVALID_LIST_NAME");
  return withTransaction(db, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`chat-lists:${userId}`]);
    const have = await client.query(`SELECT count(*)::int AS n FROM chat_lists WHERE user_id = $1`, [userId]);
    if ((have.rows[0] as { n: number }).n >= LIMITS.lists) throw new ChatError(409, "TOO_MANY_LISTS");
    const dupe = await client.query(`SELECT 1 FROM chat_lists WHERE user_id = $1 AND lower(name) = lower($2)`, [userId, trimmed]);
    if (dupe.rowCount) throw new ChatError(409, "LIST_EXISTS");
    const created = await client.query(`INSERT INTO chat_lists (user_id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color`, [userId, trimmed, color]);
    return { ...(created.rows[0] as Omit<ChatList, "count">), count: 0 };
  });
}

export async function renameChatList(db: Database, userId: string, listId: string, name: string, color?: ListColor): Promise<void> {
  const trimmed = clean(name);
  if (trimmed.length < 1 || trimmed.length > LIMITS.listName) throw new ChatError(422, "INVALID_LIST_NAME");
  const dupe = await db.query(`SELECT 1 FROM chat_lists WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3`, [userId, trimmed, listId]);
  if (dupe.rowCount) throw new ChatError(409, "LIST_EXISTS");
  const updated = await db.query(`UPDATE chat_lists SET name = $3, color = COALESCE($4, color) WHERE id = $1 AND user_id = $2`, [listId, userId, trimmed, color ?? null]);
  if (!updated.rowCount) throw new ChatError(404, "LIST_NOT_FOUND");
}

export async function deleteChatList(db: Database, userId: string, listId: string): Promise<void> {
  const deleted = await db.query(`DELETE FROM chat_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
  if (!deleted.rowCount) throw new ChatError(404, "LIST_NOT_FOUND");
}

/** Puts a chat on a list (or takes it off). Both must be this person's own. */
export async function setChatInList(db: Database, userId: string, listId: string, conversationId: string, present: boolean): Promise<void> {
  await withTransaction(db, async (client) => {
    const own = await client.query(`SELECT 1 FROM chat_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
    if (!own.rowCount) throw new ChatError(404, "LIST_NOT_FOUND");
    await assertMember(client, userId, conversationId);
    if (present) await client.query(`INSERT INTO chat_list_items (list_id, conversation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [listId, conversationId]);
    else await client.query(`DELETE FROM chat_list_items WHERE list_id = $1 AND conversation_id = $2`, [listId, conversationId]);
  });
}

export async function setConversationArchived(db: Database, userId: string, conversationId: string, archived: boolean): Promise<{ archived: boolean }> {
  return withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);
    await client.query(
      `UPDATE conversation_members SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [conversationId, userId, archived]
    );
    return { archived };
  });
}

/** People the caller may put in a group: ones they already chat with directly, and nobody blocked in either direction. */
async function assertAddable(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }, callerId: string, others: string[]): Promise<void> {
  if (others.includes(callerId)) throw new ChatError(422, "INVALID_MEMBERS");
  const known = await client.query(
    `SELECT DISTINCT peer.user_id AS id
       FROM conversation_members me
       JOIN conversations c ON c.id = me.conversation_id AND c.conversation_type = 'DIRECT'
       JOIN conversation_members peer ON peer.conversation_id = c.id AND peer.user_id <> me.user_id AND peer.removed_at IS NULL
      WHERE me.user_id = $1 AND me.removed_at IS NULL AND peer.user_id = ANY($2::uuid[])`,
    [callerId, others]
  );
  if (known.rows.length !== others.length) throw new ChatError(403, "NOT_A_CONTACT");
  const blocked = await client.query(
    `SELECT 1 FROM blocked_users WHERE (blocker_user_id = $1 AND blocked_user_id = ANY($2::uuid[])) OR (blocked_user_id = $1 AND blocker_user_id = ANY($2::uuid[])) LIMIT 1`,
    [callerId, others]
  );
  if (blocked.rowCount) throw new ChatError(403, "NOT_A_CONTACT");
}

export async function createGroup(db: Database, userId: string, title: string, memberUserIds: string[]): Promise<{ conversationId: string }> {
  const name = clean(title);
  const others = Array.from(new Set(memberUserIds));
  if (name.length < 1 || name.length > LIMITS.groupTitle) throw new ChatError(422, "INVALID_GROUP_TITLE");
  if (others.length < 1 || others.length > LIMITS.groupOthers) throw new ChatError(422, "INVALID_MEMBERS");
  return withTransaction(db, async (client) => {
    await assertAddable(client, userId, others);
    const made = await client.query(
      `INSERT INTO conversations (conversation_type, created_by_user_id, display_title, last_message_at) VALUES ('GROUP', $1, $2, now()) RETURNING id`,
      [userId, name]
    );
    const id = (made.rows[0] as { id: string }).id;
    await client.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'OWNER')`, [id, userId]);
    for (const other of others) await client.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'MEMBER')`, [id, other]);
    return { conversationId: id };
  });
}

/** Adds people to a group. Only its owner or an admin may. */
export async function addGroupMembers(db: Database, userId: string, conversationId: string, memberUserIds: string[]): Promise<{ added: number }> {
  const others = Array.from(new Set(memberUserIds));
  if (others.length < 1) throw new ChatError(422, "INVALID_MEMBERS");
  return withTransaction(db, async (client) => {
    const role = await assertMember(client, userId, conversationId);
    const kind = await client.query(`SELECT conversation_type AS type FROM conversations WHERE id = $1 FOR UPDATE`, [conversationId]);
    if ((kind.rows[0] as { type: string } | undefined)?.type !== "GROUP") throw new ChatError(422, "NOT_A_GROUP");
    if (role === "MEMBER") throw new ChatError(403, "NOT_ALLOWED");
    const current = await client.query(`SELECT user_id AS id FROM conversation_members WHERE conversation_id = $1 AND removed_at IS NULL`, [conversationId]);
    const have = new Set((current.rows as Array<{ id: string }>).map((r) => r.id));
    const fresh = others.filter((o) => !have.has(o));
    if (have.size + fresh.length > LIMITS.groupOthers + 1) throw new ChatError(409, "GROUP_FULL");
    if (fresh.length === 0) return { added: 0 };
    await assertAddable(client, userId, fresh);
    for (const other of fresh) {
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'MEMBER')
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET removed_at = NULL, joined_at = now(), archived_at = NULL`,
        [conversationId, other]
      );
    }
    return { added: fresh.length };
  });
}
