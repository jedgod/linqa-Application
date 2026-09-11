import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";

/**
 * Chat inbox for the Chats tab.
 *
 * Distinct from `/v1/mobile-hub`, which returns the whole hub (contacts,
 * media, devices, communities, call history) in one document. The inbox is the
 * one screen a user opens most, so it ships only what that screen draws, with
 * the aggregation the client would otherwise do over the wire done here.
 *
 * Three rules this endpoint is built around:
 *
 * 1. Membership is the authorization boundary. Every row is joined through
 *    `conversation_members` for the caller, so a conversation the caller was
 *    removed from cannot appear even if the client asks for it by id.
 *
 * 2. The screen never claims a capability the server cannot vouch for.
 *    `e2eeVerified` is a real lookup, not a decoration, and typing state is
 *    absent rather than invented (see `typingLabel` below).
 *
 * 3. No developer diagnostics. This is a consumer surface: no server version,
 *    no host, no environment, no row counts from other tenants.
 */

const CHAT_FILTERS = ["all", "unread", "groups", "pinned"] as const;
type ChatFilter = (typeof CHAT_FILTERS)[number];

const InboxQuery = z.object({
  filter: z.enum(CHAT_FILTERS).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

interface ConversationRow {
  conversationId: string;
  title: string;
  isGroup: boolean;
  preview: string | null;
  updatedAt: string | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  online: boolean;
  participantInitials: string[];
  e2eeVerified: boolean;
  peerUserId: string | null;
}

/** "Avery Chen" -> "AC". Group titles collapse the same way. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export async function registerChatRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/chats/inbox", async (request, reply) => {
    let principal;
    try {
      principal = await authenticate(request);
      requireScope(principal, "messages:read");
    } catch (error) {
      request.log.warn({ err: error }, "chat inbox authentication rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const parsed = InboxQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ code: "INVALID_CHAT_FILTER", details: parsed.error.flatten() });
    }
    const { filter, limit } = parsed.data;

    // The filter is applied in SQL rather than after the fact so that `limit`
    // means "50 conversations matching this filter", not "50 conversations, of
    // which some happen to match".
    const filterClause =
      filter === "unread" ? "AND cm.unread_count > 0"
      : filter === "groups" ? "AND c.conversation_type <> 'DIRECT'"
      : filter === "pinned" ? "AND cm.pinned"
      : "";

    try {
      const [conversations, scheduled, presence, totals] = await Promise.all([
        db.query(
          `SELECT c.id AS "conversationId",
                  COALESCE(c.display_title,'Conversation') AS title,
                  (c.conversation_type <> 'DIRECT') AS "isGroup",
                  c.last_message_preview AS preview,
                  c.last_message_at AS "updatedAt",
                  cm.unread_count AS "unreadCount",
                  cm.pinned,
                  cm.muted,
                  -- "Online" is a device fact, not a self-reported status: at
                  -- least one of the peer's devices checked in recently.
                  COALESCE((
                    SELECT bool_or(d.last_seen_at > now() - interval '15 minutes')
                    FROM conversation_members peer
                    JOIN devices d ON d.user_id = peer.user_id AND d.status='ACTIVE'
                    WHERE peer.conversation_id = c.id
                      AND peer.user_id <> $1 AND peer.removed_at IS NULL
                  ), FALSE) AS online,
                  COALESCE((
                    SELECT array_agg(p.display_name ORDER BY p.display_name)
                    FROM conversation_members peer
                    JOIN user_profiles p ON p.user_id = peer.user_id
                    WHERE peer.conversation_id = c.id
                      AND peer.user_id <> $1 AND peer.removed_at IS NULL
                  ), '{}') AS "participantNames",
                  -- A conversation is only presented as end-to-end encrypted
                  -- when a real MLS group state exists for it. The group is
                  -- keyed by conversation id by convention; with no ratchet
                  -- established this is false and the client omits the label
                  -- rather than asserting protection that is not in place.
                  EXISTS (SELECT 1 FROM mls_group_states g WHERE g.group_id = c.id) AS "e2eeVerified",
                  -- Direct conversations expose the one other member's id so
                  -- the row can offer a call shortcut. Groups do not: a call
                  -- button there would need the whole roster, which this
                  -- endpoint deliberately does not ship.
                  CASE WHEN c.conversation_type = 'DIRECT' THEN (
                    SELECT peer.user_id FROM conversation_members peer
                    WHERE peer.conversation_id = c.id
                      AND peer.user_id <> $1 AND peer.removed_at IS NULL
                    LIMIT 1
                  ) END AS "peerUserId"
           FROM conversations c
           JOIN conversation_members cm
             ON cm.conversation_id = c.id AND cm.user_id = $1 AND cm.removed_at IS NULL
           WHERE c.archived_at IS NULL
             AND (
               c.conversation_type <> 'DIRECT'
               OR NOT EXISTS (
                 SELECT 1
                   FROM conversation_members blocked_peer
                   JOIN blocked_users bu
                     ON (bu.blocker_user_id = $1 AND bu.blocked_user_id = blocked_peer.user_id)
                     OR (bu.blocker_user_id = blocked_peer.user_id AND bu.blocked_user_id = $1)
                  WHERE blocked_peer.conversation_id = c.id
                    AND blocked_peer.user_id <> $1
                    AND blocked_peer.removed_at IS NULL
               )
             ) ${filterClause}
           ORDER BY cm.pinned DESC, c.last_message_at DESC NULLS LAST
           LIMIT $2`,
          [principal.userId, limit]
        ),
        // Title is `title_ciphertext` and the server holds no key for it, so
        // the card is labelled from the call type and time instead of from a
        // title nobody on this side can read.
        db.query(
          `SELECT id AS "eventId", call_type AS "callType", scheduled_for AS "startsAt"
           FROM scheduled_calls
           WHERE status='SCHEDULED'
             AND scheduled_for > now() - interval '10 minutes'
             AND (organizer_user_id = $1 OR $1 = ANY(participant_user_ids))
           ORDER BY scheduled_for ASC
           LIMIT 1`,
          [principal.userId]
        ),
        db.query(
          `SELECT DISTINCT p.user_id AS "userId", p.display_name AS "displayName",
                  EXISTS (SELECT 1 FROM devices d
                          WHERE d.user_id = p.user_id AND d.status='ACTIVE'
                            AND d.last_seen_at > now() - interval '15 minutes') AS online
           FROM conversation_members mine
           JOIN conversation_members peer
             ON peer.conversation_id = mine.conversation_id
            AND peer.user_id <> mine.user_id AND peer.removed_at IS NULL
           JOIN user_profiles p ON p.user_id = peer.user_id
           WHERE mine.user_id = $1 AND mine.removed_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM blocked_users bu
                WHERE (bu.blocker_user_id = $1 AND bu.blocked_user_id = peer.user_id)
                   OR (bu.blocker_user_id = peer.user_id AND bu.blocked_user_id = $1)
             )
           ORDER BY online DESC, p.display_name
           LIMIT 12`,
          [principal.userId]
        ),
        // Unread total spans the whole inbox, not the filtered slice, so the
        // tab badge does not change when the user taps "Groups".
        db.query(
          `SELECT COALESCE(sum(cm.unread_count),0)::int AS "unreadTotal",
                  count(*) FILTER (WHERE cm.unread_count > 0)::int AS "unread",
                  count(*)::int AS "all",
                  count(*) FILTER (WHERE c.conversation_type <> 'DIRECT')::int AS "groups",
                  count(*) FILTER (WHERE cm.pinned)::int AS "pinned"
           FROM conversations c
           JOIN conversation_members cm
             ON cm.conversation_id = c.id AND cm.user_id = $1 AND cm.removed_at IS NULL
           WHERE c.archived_at IS NULL
             AND (
               c.conversation_type <> 'DIRECT'
               OR NOT EXISTS (
                 SELECT 1
                   FROM conversation_members blocked_peer
                   JOIN blocked_users bu
                     ON (bu.blocker_user_id = $1 AND bu.blocked_user_id = blocked_peer.user_id)
                     OR (bu.blocker_user_id = blocked_peer.user_id AND bu.blocked_user_id = $1)
                  WHERE blocked_peer.conversation_id = c.id
                    AND blocked_peer.user_id <> $1
                    AND blocked_peer.removed_at IS NULL
               )
             )`,
          [principal.userId]
        )
      ]);

      const counts = (totals.rows[0] ?? {}) as Record<string, number>;
      const call = scheduled.rows[0] as
        | { eventId: string; callType: string; startsAt: string }
        | undefined;

      const rows = (conversations.rows as Array<ConversationRow & { participantNames: string[] }>).map(
        (row) => ({
          conversationId: row.conversationId,
          title: row.title,
          initials: initialsOf(row.title),
          isGroup: row.isGroup,
          // Stacked group avatars need the members, but only their initials
          // travel: the inbox has no business shipping a member roster to
          // render three circles.
          participantInitials: (row.participantNames ?? []).slice(0, 3).map(initialsOf),
          preview: row.preview,
          updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
          unreadCount: Number(row.unreadCount ?? 0),
          pinned: Boolean(row.pinned),
          muted: Boolean(row.muted),
          online: Boolean(row.online),
          e2eeVerified: Boolean(row.e2eeVerified),
          peerUserId: row.peerUserId ?? null
          // `typingLabel` is deliberately absent. There is no typing transport
          // on this server yet, and a client-side guess would be a fabricated
          // presence signal about another person. The client renders the field
          // when it appears; until then the row shows the real last message.
        })
      );

      void reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send({
        generatedAt: new Date().toISOString(),
        unreadTotal: Number(counts.unreadTotal ?? 0),
        counts: {
          all: Number(counts.all ?? 0),
          unread: Number(counts.unread ?? 0),
          groups: Number(counts.groups ?? 0),
          pinned: Number(counts.pinned ?? 0)
        },
        scheduledCall: call
          ? {
              eventId: call.eventId,
              callType: call.callType,
              startsAt: new Date(call.startsAt).toISOString(),
              // Joining opens inside a window the server owns; the client does
              // not get to decide it is early enough.
              joinable: Date.parse(String(call.startsAt)) - Date.now() <= 15 * 60_000
            }
          : null,
        presence: (presence.rows as Array<{ userId: string; displayName: string; online: boolean }>).map(
          (row) => ({
            userId: row.userId,
            displayName: row.displayName,
            initials: initialsOf(row.displayName),
            online: Boolean(row.online)
          })
        ),
        conversations: rows
      });
    } catch (error) {
      request.log.error({ err: error, userId: principal.userId }, "chat inbox build failed");
      return reply.code(503).send({ code: "CHAT_INBOX_UNAVAILABLE" });
    }
  });

  app.post("/v1/chats/:conversationId/read", async (request, reply) => {
    let principal;
    try {
      principal = await authenticate(request);
      requireScope(principal, "messages:read");
    } catch (error) {
      request.log.warn({ err: error }, "chat read receipt authentication rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const params = z.object({ conversationId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(422).send({ code: "INVALID_CONVERSATION_ID" });

    // Scoped to the caller's own membership row, so this can only ever clear
    // the caller's counter -- never another member's.
    const cleared = await db.query(
      `UPDATE conversation_members SET unread_count = 0
        WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [params.data.conversationId, principal.userId]
    );
    if (!cleared.rowCount) {
      // Same answer for "no such conversation" and "not a member", so this
      // cannot be used to probe which conversation ids exist.
      return reply.code(404).send({ code: "CONVERSATION_NOT_FOUND" });
    }
    return reply.code(204).send();
  });
}
