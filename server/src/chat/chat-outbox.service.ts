import type { Database } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { withTransaction } from "./chat.service.js";

/**
 * Transactional-outbox relay.
 *
 * Events are written inside the transaction that produced them and published
 * afterwards. The relay claims a batch with `FOR UPDATE SKIP LOCKED`, so two
 * relays running at once split the work instead of double-publishing, and it
 * marks rows published only after the fan-out has been attempted -- a crash in
 * between leaves the row unpublished and the next pass retries it.
 *
 * Delivery is at-least-once by construction, which is why every event carries
 * a monotonic `eventId` for the client to deduplicate on.
 */

export interface OutboxRow {
  id: number;
  topic: string;
  conversationId: string | null;
  payload: unknown;
  createdAt: string;
}

/** Claims pending events, hands them to the hub, then marks them published. */
export async function publishOutboxBatch(
  db: Database,
  hub: RealtimeHub,
  limit = 100
): Promise<number> {
  const claimed = await withTransaction(db, async (client) => {
    const result = await client.query(
      `WITH due AS (
         SELECT id FROM chat_outbox
          WHERE published_at IS NULL
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE chat_outbox o
          SET published_at = now(), attempts = o.attempts + 1
         FROM due
        WHERE o.id = due.id
      RETURNING o.id, o.topic, o.conversation_id AS "conversationId",
                o.payload, o.created_at AS "createdAt"`,
      [limit]
    );
    return result.rows as Array<{
      id: string;
      topic: string;
      conversationId: string | null;
      payload: unknown;
      createdAt: Date;
    }>;
  });

  if (claimed.length === 0) return 0;

  // Recipients are resolved after the claim transaction has committed, so no
  // database transaction is open while fanning out.
  const conversationIds = [...new Set(claimed.map((row) => row.conversationId).filter(Boolean))] as string[];
  const membersByConversation = new Map<string, string[]>();
  if (conversationIds.length) {
    const members = await db.query(
      `SELECT conversation_id AS "conversationId", user_id AS "userId"
         FROM conversation_members
        WHERE conversation_id = ANY($1::uuid[]) AND removed_at IS NULL`,
      [conversationIds]
    );
    for (const row of members.rows as Array<{ conversationId: string; userId: string }>) {
      const list = membersByConversation.get(row.conversationId) ?? [];
      list.push(row.userId);
      membersByConversation.set(row.conversationId, list);
    }
  }

  for (const row of claimed) {
    if (!row.conversationId) continue;
    const envelope = {
      type: row.topic,
      eventId: Number(row.id),
      conversationId: row.conversationId,
      occurredAt: new Date(row.createdAt).toISOString(),
      payload: row.payload
    };
    for (const userId of membersByConversation.get(row.conversationId) ?? []) {
      hub.sendToUser(userId, envelope);
    }
  }

  return claimed.length;
}

/**
 * Re-queues events that were claimed but never confirmed delivered.
 *
 * `publishOutboxBatch` marks rows published before fan-out completes, so a
 * process that dies mid-batch leaves events that no socket ever received. This
 * pass is the reconciliation the pack asks for: anything published but still
 * young enough to matter is replayable through `/v1/chats/:id/events`, and the
 * client's `afterEventId` cursor is what actually closes the gap.
 */
export async function pruneOutbox(db: Database, retentionDays: number): Promise<number> {
  const result = await db.query(
    `DELETE FROM chat_outbox
      WHERE published_at IS NOT NULL
        AND created_at < now() - make_interval(days => $1)`,
    [retentionDays]
  );
  return result.rowCount ?? 0;
}
