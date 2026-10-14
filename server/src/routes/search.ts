import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import { createAuthenticator, requireScope } from '../auth/jwt.js';

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  kind: z.enum(['all', 'chats', 'people']).default('all'),
  limit: z.coerce.number().int().min(1).max(30).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function registerSearchRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const authenticate = createAuthenticator(config);
  app.get('/v1/search', async (request, reply) => {
    let principal;
    try {
      principal = await authenticate(request);
      requireScope(principal, 'messages:read');
      if (principal.deviceId) {
        const device = await db.query("SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL", [principal.deviceId, principal.userId]);
        if (!device.rowCount) throw new Error('Revoked device');
      }
    } catch { return reply.code(401).send({ message: 'Sign in again to search.' }); }
    const parsed = SearchQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ message: 'Enter between 2 and 100 characters.' });
    const { q, kind, limit, offset } = parsed.data;
    const parameters = [principal.userId, q, limit + 1, offset];
    try {
      const [chats, people] = await Promise.all([
        kind === 'people' ? Promise.resolve({ rows: [] }) : db.query(
          `SELECT c.id AS "conversationId", c.conversation_type <> 'DIRECT' AS "isGroup",
             CASE WHEN c.conversation_type = 'DIRECT' THEN COALESCE(peers.names, c.display_title, 'Conversation')
                  ELSE COALESCE(c.display_title, 'Group') END AS title,
             cm.unread_count AS "unreadCount", cm.archived_at IS NOT NULL AS archived,
             c.last_message_at AS "updatedAt", peers.peer_id AS "peerUserId"
           FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 AND cm.removed_at IS NULL
           LEFT JOIN LATERAL (
             SELECT string_agg(p.display_name, ', ' ORDER BY p.display_name) AS names,
                    CASE WHEN c.conversation_type='DIRECT' THEN min(peer.user_id::text) END AS peer_id
             FROM conversation_members peer JOIN user_profiles p ON p.user_id=peer.user_id
             WHERE peer.conversation_id=c.id AND peer.user_id<>$1 AND peer.removed_at IS NULL
           ) peers ON TRUE
           WHERE c.archived_at IS NULL AND (cm.hidden_at IS NULL OR c.last_message_at>cm.hidden_at)
             AND (c.conversation_type <> 'DIRECT' OR NOT EXISTS (
               SELECT 1 FROM conversation_members peer JOIN blocked_users b
                 ON (b.blocker_user_id=$1 AND b.blocked_user_id=peer.user_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=peer.user_id)
               WHERE peer.conversation_id=c.id AND peer.user_id<>$1 AND peer.removed_at IS NULL))
             AND (strpos(lower(COALESCE(c.display_title,'')),lower($2))>0 OR strpos(lower(COALESCE(peers.names,'')),lower($2))>0)
           ORDER BY c.last_message_at DESC NULLS LAST, c.id LIMIT $3 OFFSET $4`, parameters),
        kind === 'chats' ? Promise.resolve({ rows: [] }) : db.query(
          `SELECT p.user_id AS "userId", p.display_name AS "displayName", n.normalized_username AS username
           FROM user_profiles p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE'
           LEFT JOIN usernames n ON n.user_id=p.user_id
           WHERE p.user_id<>$1 AND (
             EXISTS (SELECT 1 FROM chat_contacts cc WHERE cc.owner_user_id=$1 AND cc.contact_user_id=p.user_id)
             OR EXISTS (SELECT 1 FROM conversation_members mine JOIN conversation_members peer ON peer.conversation_id=mine.conversation_id
                WHERE mine.user_id=$1 AND mine.removed_at IS NULL AND peer.user_id=p.user_id AND peer.removed_at IS NULL))
             AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=p.user_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=p.user_id))
             AND (strpos(lower(COALESCE(p.display_name,'')),lower($2))>0 OR strpos(lower(COALESCE(n.normalized_username,'')),lower(NULLIF(ltrim($2,'@'),'')))>0)
           ORDER BY p.display_name, p.user_id LIMIT $3 OFFSET $4`, parameters),
      ]);
      const hasMore = chats.rows.length > limit || people.rows.length > limit;
      return reply.header('Cache-Control', 'private, no-store').send({
        query: q, chats: chats.rows.slice(0, limit), people: people.rows.slice(0, limit),
        nextOffset: hasMore && offset + limit <= 1000 ? offset + limit : null,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Search failed');
      return reply.code(503).send({ message: 'Search is temporarily unavailable. Try again.' });
    }
  });
}
