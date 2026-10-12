import type { Database } from "../db/pool.js";
import { ChatError, assertMember, withTransaction } from "../chat/chat.service.js";
import { TrustSafetyService } from "../services/trust-safety.service.js";

export const REPORT_CATEGORIES = ["HARASSMENT", "IMPERSONATION", "THREATS", "SCAM", "SEXUAL_CONTENT", "HATE", "MINOR_SAFETY", "OTHER"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface ChatControls {
  conversationId: string;
  isGroup: boolean;
  title: string;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  disappearAfterSeconds: number | null;
  /** The other person on a direct chat. */
  peer: { userId: string; displayName: string; online: boolean; blockedByMe: boolean } | null;
  /** People in a group, this person included. */
  members: Array<{ userId: string; displayName: string; role: string }>;
  createdAt: string;
}

/** Everything the chat's menu and Contact info need, in one read. Only a member can ask. */
export async function chatControls(db: Database, userId: string, conversationId: string): Promise<ChatControls> {
  const client = await db.connect();
  try {
    await assertMember(client, userId, conversationId);
    const head = await client.query(
      `SELECT c.conversation_type AS type, COALESCE(c.display_title,'Conversation') AS title, c.disappear_after_seconds AS seconds, c.created_at AS "createdAt",
              cm.muted, cm.pinned, (cm.archived_at IS NOT NULL) AS archived
         FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2 AND cm.removed_at IS NULL
        WHERE c.id = $1`,
      [conversationId, userId]
    );
    const row = head.rows[0] as { type: string; title: string; seconds: number | null; createdAt: Date; muted: boolean; pinned: boolean; archived: boolean } | undefined;
    if (!row) throw new ChatError(404, "CONVERSATION_NOT_FOUND");
    const people = await client.query(
      `SELECT m.user_id AS "userId", COALESCE(p.display_name,'Linqa user') AS "displayName", m.role,
              COALESCE((SELECT bool_or(d.last_seen_at > now() - interval '15 minutes') FROM devices d WHERE d.user_id = m.user_id AND d.status = 'ACTIVE'), FALSE) AS online,
              EXISTS (SELECT 1 FROM blocked_users b WHERE b.blocker_user_id = $2 AND b.blocked_user_id = m.user_id) AS "blockedByMe"
         FROM conversation_members m LEFT JOIN user_profiles p ON p.user_id = m.user_id
        WHERE m.conversation_id = $1 AND m.removed_at IS NULL ORDER BY p.display_name`,
      [conversationId, userId]
    );
    const all = people.rows as Array<{ userId: string; displayName: string; role: string; online: boolean; blockedByMe: boolean }>;
    const isGroup = row.type !== "DIRECT";
    const other = all.find((m) => m.userId !== userId);
    return {
      conversationId,
      isGroup,
      title: !isGroup && other ? other.displayName : row.title,
      muted: row.muted,
      pinned: row.pinned,
      archived: row.archived,
      disappearAfterSeconds: row.seconds,
      peer: !isGroup && other ? { userId: other.userId, displayName: other.displayName, online: Boolean(other.online), blockedByMe: Boolean(other.blockedByMe) } : null,
      // Everyone in the conversation, direct chats included: the phones read this to know who a message must be sealed for.
      members: all.map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role })),
      createdAt: new Date(row.createdAt).toISOString()
    };
  } finally {
    client.release();
  }
}

/** Removes the chat's earlier messages from this person's view only. */
export async function clearChat(db: Database, userId: string, conversationId: string): Promise<void> {
  await withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);
    await client.query(`UPDATE conversation_members SET cleared_at = now() WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`, [conversationId, userId]);
    await client.query(`UPDATE conversation_members SET unread_count = 0 WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
  });
}

/** Clears the chat and takes it out of this person's list. A newer message from someone brings it back (empty of the past). */
export async function deleteChat(db: Database, userId: string, conversationId: string): Promise<void> {
  await withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);
    await client.query(
      `UPDATE conversation_members SET cleared_at = now(), hidden_at = now(), unread_count = 0, archived_at = NULL, pinned = FALSE
        WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [conversationId, userId]
    );
    await client.query(`DELETE FROM chat_list_items WHERE conversation_id = $1 AND list_id IN (SELECT id FROM chat_lists WHERE user_id = $2)`, [conversationId, userId]);
  });
}

/** A report about the other person in a direct chat (or about a group). The conversation id goes in the description so a reviewer can find it. */
export async function reportChat(db: Database, userId: string, conversationId: string, category: ReportCategory, description: string): Promise<{ id: string }> {
  const controls = await chatControls(db, userId, conversationId);
  const text = description.trim();
  if (text.length < 10) throw new ChatError(422, "DESCRIPTION_TOO_SHORT");
  const report = await new TrustSafetyService(db).submitReport({
    reporterUserId: userId,
    ...(controls.peer ? { reportedUserId: controls.peer.userId } : {}),
    category,
    description: `${text}\n\n(conversation ${conversationId})`.slice(0, 5000)
  });
  return { id: (report as { id: string }).id };
}
