import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { Database } from "../db/pool.js";
import { authorizeNewDirectChat, liveChatAccessDeps } from "../services/countrylinqa/chat-access.js";

export type ChatRole = "OWNER" | "ADMIN" | "MEMBER";

/** Error the route layer maps to an HTTP status without leaking internals. */
export class ChatError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ChatError";
  }
}

type Client = pg.PoolClient;

/**
 * Runs `work` in a transaction.
 *
 * The rollback is itself guarded: the pack's version calls `ROLLBACK`
 * unguarded in the catch, so a connection that died mid-transaction throws a
 * *second* error there and the original cause -- the one that explains the
 * failure -- is lost.
 */
export async function withTransaction<T>(db: Database, work: (client: Client) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Report the failure that actually happened, not the cleanup's.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The authorization boundary for every chat operation.
 *
 * Answers 404 rather than 403 on purpose: a 403 confirms the conversation
 * exists, which turns this into an oracle for enumerating other people's
 * conversation ids.
 */
export async function assertMember(
  client: Client,
  userId: string,
  conversationId: string
): Promise<ChatRole> {
  const result = await client.query(
    `SELECT cm.role
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = $1
         AND cm.user_id = $2
         AND cm.removed_at IS NULL
         AND c.archived_at IS NULL
         AND (
           c.conversation_type <> 'DIRECT'
           OR NOT EXISTS (
             SELECT 1
               FROM conversation_members peer
               JOIN blocked_users bu
                 ON (bu.blocker_user_id = $2 AND bu.blocked_user_id = peer.user_id)
                 OR (bu.blocker_user_id = peer.user_id AND bu.blocked_user_id = $2)
              WHERE peer.conversation_id = c.id
                AND peer.user_id <> $2
                AND peer.removed_at IS NULL
           )
         )`,
    [conversationId, userId]
  );
  if (!result.rowCount) throw new ChatError(404, "CONVERSATION_NOT_FOUND");
  return (result.rows[0] as { role: ChatRole }).role;
}

/** Keeps only the conversations this user is actually a member of. */
export async function filterMemberConversations(
  db: Database,
  userId: string,
  conversationIds: string[]
): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const result = await db.query(
    `SELECT cm.conversation_id AS id
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = $1
         AND cm.removed_at IS NULL
         AND c.archived_at IS NULL
         AND (
           c.conversation_type <> 'DIRECT'
           OR NOT EXISTS (
             SELECT 1
               FROM conversation_members peer
               JOIN blocked_users bu
                 ON (bu.blocker_user_id = $1 AND bu.blocked_user_id = peer.user_id)
                 OR (bu.blocker_user_id = peer.user_id AND bu.blocked_user_id = $1)
              WHERE peer.conversation_id = c.id
                AND peer.user_id <> $1
                AND peer.removed_at IS NULL
           )
         )
         AND cm.conversation_id = ANY($2::uuid[])`,
    [userId, conversationIds]
  );
  return (result.rows as Array<{ id: string }>).map((row) => row.id);
}

/**
 * Appends a durable event in the same transaction as the state change.
 *
 * Realtime delivery is a best-effort optimization layered on top; this row is
 * the record, and a client that missed a socket frame replays from it.
 */
export async function appendOutbox(
  client: Client,
  topic: string,
  conversationId: string | null,
  payload: unknown
): Promise<number> {
  const result = await client.query(
    `INSERT INTO chat_outbox (topic, conversation_id, payload)
     VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [topic, conversationId, JSON.stringify(payload)]
  );
  return Number((result.rows[0] as { id: string }).id);
}

/**
 * Resolves, or atomically creates, the one direct conversation between two
 * users.
 *
 * The pair is ordered by the database (`LEAST`/`GREATEST` on `uuid`) rather
 * than by a JavaScript string sort, so the ordering used for the advisory lock
 * and the ordering enforced by the table's CHECK are the same comparison.
 */
export async function resolveDirectConversation(
  db: Database,
  callerId: string,
  otherUserId: string
): Promise<{ conversationId: string; created: boolean }> {
  if (callerId === otherUserId) throw new ChatError(422, "SELF_CHAT_NOT_ALLOWED");

  return withTransaction(db, async (client) => {
    const blocked = await client.query(
      `SELECT 1 FROM blocked_users
        WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
           OR (blocker_user_id = $2 AND blocked_user_id = $1)`,
      [callerId, otherUserId]
    );
    if (blocked.rowCount) throw new ChatError(404, "USER_NOT_FOUND");

    const target = await client.query(
      `SELECT COALESCE(p.display_name,'Linqa User') AS "displayName"
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1 AND u.status = 'ACTIVE'`,
      [otherUserId]
    );
    if (!target.rowCount) throw new ChatError(404, "USER_NOT_FOUND");

    const ordered = await client.query(
      `SELECT LEAST($1::uuid,$2::uuid) AS low, GREATEST($1::uuid,$2::uuid) AS high`,
      [callerId, otherUserId]
    );
    const { low, high } = ordered.rows[0] as { low: string; high: string };

    // Serializes concurrent first-contact between the same pair; ten parallel
    // creates collapse to one conversation instead of ten.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`direct:${low}:${high}`]);

    const existing = await client.query(
      `SELECT conversation_id AS "conversationId" FROM direct_conversation_keys
        WHERE user_low = $1 AND user_high = $2`,
      [low, high]
    );
    if (existing.rowCount) {
      return {
        conversationId: (existing.rows[0] as { conversationId: string }).conversationId,
        created: false
      };
    }

    // CountryLinqa chat access: this is the only place a direct conversation is created, so the
    // recipient's "who can start a chat with me" setting is enforced here and cannot be bypassed by
    // a different route. An existing conversation returned above is never affected.
    const decision = await authorizeNewDirectChat(callerId, otherUserId, liveChatAccessDeps(client));
    if (!decision.allowed) throw new ChatError(403, decision.code);

    const conversation = await client.query(
      `INSERT INTO conversations (conversation_type, created_by_user_id, display_title, last_message_at)
       VALUES ('DIRECT', $1, $2, now()) RETURNING id`,
      [callerId, (target.rows[0] as { displayName: string }).displayName]
    );
    const conversationId = (conversation.rows[0] as { id: string }).id;

    await client.query(
      `INSERT INTO direct_conversation_keys (user_low, user_high, conversation_id) VALUES ($1,$2,$3)`,
      [low, high, conversationId]
    );
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1,$2,'OWNER'), ($1,$3,'MEMBER')`,
      [conversationId, callerId, otherUserId]
    );
    return { conversationId, created: true };
  });
}

export interface SendMessageInput {
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string | undefined;
  clientMessageId: string;
  kind: "TEXT" | "VOICE" | "PHOTOS" | "CALL" | "SYSTEM";
  ciphertextBase64: string | undefined;
  mediaCount: number;
  replyToId: string | undefined;
}

export interface SentMessage {
  id: string;
  conversationId: string;
  senderUserId: string;
  kind: string;
  createdAt: string;
  eventId: number | null;
  duplicate: boolean;
}

/**
 * Appends a message and the durable event for it, idempotently.
 *
 * Retrying with the same `clientMessageId` returns the original message and
 * does *not* emit a second event -- so a client that retries after a timeout
 * cannot make the conversation show the message twice.
 */
export async function sendMessage(db: Database, input: SendMessageInput): Promise<SentMessage> {
  const needsBody = input.kind !== "CALL" && input.kind !== "SYSTEM";
  let ciphertext: Buffer | null = null;
  if (needsBody) {
    if (!input.ciphertextBase64) throw new ChatError(422, "CIPHERTEXT_REQUIRED");
    ciphertext = Buffer.from(input.ciphertextBase64, "base64");
    // `Buffer.from` silently drops characters that are not base64, so a
    // malformed body would otherwise be stored as a shorter, corrupt value.
    if (ciphertext.toString("base64").replace(/=+$/, "") !== input.ciphertextBase64.replace(/=+$/, "")) {
      throw new ChatError(422, "CIPHERTEXT_NOT_BASE64");
    }
    if (ciphertext.byteLength === 0) throw new ChatError(422, "CIPHERTEXT_EMPTY");
    if (ciphertext.byteLength > 65_536) throw new ChatError(413, "CIPHERTEXT_TOO_LARGE");
  } else if (input.ciphertextBase64) {
    throw new ChatError(422, "BODY_NOT_ALLOWED_FOR_KIND");
  }

  return withTransaction(db, async (client) => {
    await assertMember(client, input.senderUserId, input.conversationId);

    // Serialize acceptance against unlink's device-row update. A JWT issued
    // before unlink must not authorize new messages after revocation.
    if (input.senderDeviceId) {
      const device = await client.query(`SELECT id FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL FOR SHARE`, [input.senderDeviceId,input.senderUserId]);
      if (!device.rowCount) throw new ChatError(401, 'DEVICE_REQUIRED');
    }

    // Disappearing messages: drop what has already expired here, and stamp this message with its own expiry.
    await client.query(`DELETE FROM chat_messages WHERE conversation_id = $1 AND expires_at IS NOT NULL AND expires_at <= now()`, [input.conversationId]);
    const setting = await client.query(`SELECT disappear_after_seconds AS "seconds" FROM conversations WHERE id = $1`, [input.conversationId]);
    const seconds = (setting.rows[0] as { seconds: number | null } | undefined)?.seconds ?? null;
    const expiresAt = seconds ? new Date(Date.now() + seconds * 1000) : null;

    const inserted = await client.query(
      `INSERT INTO chat_messages
         (conversation_id, sender_user_id, sender_device_id, client_message_id,
          kind, body_ciphertext, media_count, reply_to_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (conversation_id, sender_user_id, client_message_id) DO NOTHING
       RETURNING id, conversation_id AS "conversationId", sender_user_id AS "senderUserId",
                 kind::text AS kind, created_at AS "createdAt"`,
      [
        input.conversationId,
        input.senderUserId,
        input.senderDeviceId ?? null,
        input.clientMessageId,
        input.kind,
        ciphertext,
        input.mediaCount,
        input.replyToId ?? null,
        expiresAt
      ]
    );

    if (!inserted.rowCount) {
      // Already stored by an earlier attempt. Re-read it and return the same
      // identity, without a second outbox event.
      const existing = await client.query(
        `SELECT id, conversation_id AS "conversationId", sender_user_id AS "senderUserId",
                kind::text AS kind, created_at AS "createdAt"
           FROM chat_messages
          WHERE conversation_id=$1 AND sender_user_id=$2 AND client_message_id=$3`,
        [input.conversationId, input.senderUserId, input.clientMessageId]
      );
      const row = existing.rows[0] as {
        id: string;
        conversationId: string;
        senderUserId: string;
        kind: string;
        createdAt: Date;
      };
      return {
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        eventId: null,
        duplicate: true
      };
    }

    const row = inserted.rows[0] as {
      id: string;
      conversationId: string;
      senderUserId: string;
      kind: string;
      createdAt: Date;
    };

    // The server cannot read the body, so the inbox preview is cleared rather
    // than guessed; the client renders a kind label ("Voice message", ...).
    await client.query(
      `UPDATE conversations SET last_message_at = $2, last_message_preview = NULL WHERE id = $1`,
      [input.conversationId, row.createdAt]
    );
    // Everyone except the sender gains one unread.
    await client.query(
      `UPDATE conversation_members SET unread_count = unread_count + 1
        WHERE conversation_id = $1 AND user_id <> $2 AND removed_at IS NULL`,
      [input.conversationId, input.senderUserId]
    );

    const eventId = await appendOutbox(client, "message.created", input.conversationId, {
      messageId: row.id,
      conversationId: row.conversationId,
      senderUserId: row.senderUserId,
      kind: row.kind,
      createdAt: new Date(row.createdAt).toISOString()
    });

    // Queued in the same transaction as the message, so a push is never
    // scheduled for a message that rolled back. Keyed on the message id, so a
    // retried send cannot enqueue a second notification.
    await client.query(
      `INSERT INTO chat_delivery_jobs (job_type, dedupe_key, payload)
       VALUES ('push.message', $1, $2::jsonb)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        `push:${row.id}`,
        JSON.stringify({
          conversationId: input.conversationId,
          senderUserId: input.senderUserId,
          messageId: row.id
        })
      ]
    );

    return {
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      eventId,
      duplicate: false
    };
  });
}

/**
 * Advances this member's read pointer to the newest message.
 *
 * Two fixes over the pack: an empty conversation leaves the existing pointer
 * alone instead of nulling it, and the pointer only ever moves forward, so a
 * late request from a backgrounded device cannot un-read newer messages.
 */
export const DISAPPEAR_OPTIONS = [86_400, 604_800, 2_419_200] as const;
export type ConversationSettings = { muted: boolean; pinned: boolean; disappearAfterSeconds: number | null };

/** This member's settings for one conversation (mute, pin) and the conversation's disappearing-messages setting. */
export async function getConversationSettings(db: Database, userId: string, conversationId: string): Promise<ConversationSettings> {
  const client = await db.connect();
  try {
    await assertMember(client, userId, conversationId);
    const r = await client.query(
      `SELECT cm.muted, cm.pinned, c.disappear_after_seconds AS "seconds"
         FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
        WHERE cm.conversation_id = $1 AND cm.user_id = $2 AND cm.removed_at IS NULL`,
      [conversationId, userId]
    );
    const row = r.rows[0] as { muted: boolean; pinned: boolean; seconds: number | null } | undefined;
    if (!row) throw new ChatError(404, "CONVERSATION_NOT_FOUND");
    return { muted: row.muted, pinned: row.pinned, disappearAfterSeconds: row.seconds };
  } finally {
    client.release();
  }
}

/** Pins or unpins a conversation for this member only. */
export async function setConversationPinned(db: Database, userId: string, conversationId: string, pinned: boolean): Promise<{ pinned: boolean }> {
  return withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);
    await client.query(
      `UPDATE conversation_members SET pinned = $3 WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [conversationId, userId, pinned]
    );
    return { pinned };
  });
}

/**
 * Turns disappearing messages on (1 day, 1 week or 4 weeks) or off for the whole conversation; any member can change it.
 * It applies to messages sent afterwards; existing messages keep the expiry they were stored with.
 */
export async function setDisappearAfter(db: Database, userId: string, conversationId: string, seconds: number | null): Promise<{ disappearAfterSeconds: number | null }> {
  if (seconds !== null && !(DISAPPEAR_OPTIONS as readonly number[]).includes(seconds)) throw new ChatError(422, "INVALID_DISAPPEAR_SETTING");
  return withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);
    await client.query(`UPDATE conversations SET disappear_after_seconds = $2 WHERE id = $1`, [conversationId, seconds]);
    return { disappearAfterSeconds: seconds };
  });
}

/**
 * Mutes or unmutes a conversation for this member only. A muted conversation still delivers messages; the push
 * worker just does not light up the phone. Only a member can change it, and only their own setting.
 */
export async function setConversationMuted(
  db: Database,
  userId: string,
  conversationId: string,
  muted: boolean
): Promise<{ muted: boolean }> {
  return withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);
    await client.query(
      `UPDATE conversation_members SET muted = $3
        WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [conversationId, userId, muted]
    );
    return { muted };
  });
}

export async function markConversationRead(
  db: Database,
  userId: string,
  conversationId: string
): Promise<{ lastReadMessageId: string | null }> {
  return withTransaction(db, async (client) => {
    await assertMember(client, userId, conversationId);

    const newest = await client.query(
      `SELECT id, created_at AS "createdAt" FROM chat_messages
        WHERE conversation_id = $1 AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM chat_message_deletions md WHERE md.message_id=chat_messages.id AND md.user_id=$2)
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [conversationId, userId]
    );
    const latest = newest.rows[0] as { id: string; createdAt: Date } | undefined;

    await client.query(
      `UPDATE conversation_members
          SET unread_count = 0,
              last_read_message_id = COALESCE($3, last_read_message_id),
              last_read_at = GREATEST(COALESCE(last_read_at, to_timestamp(0)), COALESCE($4, to_timestamp(0)))
        WHERE conversation_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [conversationId, userId, latest?.id ?? null, latest?.createdAt ?? null]
    );

    await appendOutbox(client, "conversation.read", conversationId, {
      conversationId,
      userId,
      lastReadMessageId: latest?.id ?? null
    });

    return { lastReadMessageId: latest?.id ?? null };
  });
}

/** Opaque keyset cursor: "<iso timestamp>|<uuid>". */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new ChatError(422, "INVALID_CURSOR");
  }
  return { createdAt, id };
}

/**
 * One page of a conversation, newest first.
 *
 * Keyset pagination rather than OFFSET: a busy conversation shifts under an
 * offset and the client silently skips or repeats messages.
 */
export async function listMessages(
  db: Database,
  userId: string,
  conversationId: string,
  limit: number,
  cursor?: string
): Promise<{ messages: unknown[]; nextCursor: string | null }> {
  const client = await db.connect();
  try {
    await assertMember(client, userId, conversationId);
    const after = cursor ? decodeCursor(cursor) : null;
    // Postgres' encode(..., 'base64') wraps its output with a newline every 76 characters; clients reject that as invalid base64.
    const result = await client.query(
      `SELECT id, sender_user_id AS "senderUserId", kind::text AS kind,
              replace(encode(body_ciphertext,'base64'), chr(10), '') AS "ciphertext",
              media_count AS "mediaCount", reply_to_id AS "replyToId",
              created_at AS "createdAt", edited_at AS "editedAt"
         FROM chat_messages
        WHERE conversation_id = $1 AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM chat_message_deletions md WHERE md.message_id=chat_messages.id AND md.user_id=$5)
          AND (expires_at IS NULL OR expires_at > now())
          AND created_at > COALESCE((SELECT cleared_at FROM conversation_members WHERE conversation_id = $1 AND user_id = $5), '-infinity'::timestamptz)
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [conversationId, after?.createdAt ?? null, after?.id ?? null, limit, userId]
    );

    const rows = result.rows as Array<{ id: string; createdAt: Date }>;
    const last = rows[rows.length - 1];
    return {
      messages: rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
      nextCursor:
        rows.length === limit && last ? encodeCursor(new Date(last.createdAt).toISOString(), last.id) : null
    };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// QR contact exchange
// ---------------------------------------------------------------------------

export function hashQrToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export async function issueContactQrToken(
  db: Database,
  ownerUserId: string,
  ttlSeconds: number
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const result = await withTransaction(db, async (client) => {
    // Issuing a new code retires the previous ones. Otherwise every code a
    // user ever generated stays redeemable until it expires, and "show a new
    // QR" does not actually withdraw the old one.
    await client.query(
      `UPDATE contact_qr_tokens SET revoked_at = now()
        WHERE owner_user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [ownerUserId]
    );
    return client.query(
      `INSERT INTO contact_qr_tokens (owner_user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))
       RETURNING expires_at AS "expiresAt"`,
      [ownerUserId, hashQrToken(token), ttlSeconds]
    );
  });
  return {
    token,
    expiresAt: new Date((result.rows[0] as { expiresAt: Date }).expiresAt).toISOString()
  };
}

/**
 * Redeems a QR token exactly once, even under concurrent scans.
 *
 * `FOR UPDATE` serializes redeemers on the token row, and the use count is
 * re-read inside that lock, so two simultaneous scans of a single-use code
 * produce one success and one 410 rather than two contacts.
 */
export async function redeemContactQrToken(
  db: Database,
  redeemerUserId: string,
  token: string
): Promise<{ contactUserId: string }> {
  return withTransaction(db, async (client) => {
    const found = await client.query(
      `SELECT id, owner_user_id AS "ownerUserId", expires_at AS "expiresAt",
              max_uses AS "maxUses", use_count AS "useCount", revoked_at AS "revokedAt"
         FROM contact_qr_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashQrToken(token)]
    );
    const record = found.rows[0] as
      | {
          id: string;
          ownerUserId: string;
          expiresAt: Date;
          maxUses: number;
          useCount: number;
          revokedAt: Date | null;
        }
      | undefined;

    // One answer for absent, expired, revoked and exhausted: distinguishing
    // them tells a scanner whether a token ever existed.
    if (
      !record ||
      record.revokedAt ||
      record.useCount >= record.maxUses ||
      new Date(record.expiresAt).getTime() <= Date.now()
    ) {
      throw new ChatError(410, "QR_INVALID_OR_EXPIRED");
    }
    if (record.ownerUserId === redeemerUserId) throw new ChatError(422, "QR_SELF_REDEEM");

    await client.query(`UPDATE contact_qr_tokens SET use_count = use_count + 1 WHERE id = $1`, [
      record.id
    ]);
    // Reciprocal, because showing someone a QR code is an offer to exchange.
    await client.query(
      `INSERT INTO chat_contacts (owner_user_id, contact_user_id, created_via)
       VALUES ($1,$2,'QR'), ($2,$1,'QR') ON CONFLICT DO NOTHING`,
      [redeemerUserId, record.ownerUserId]
    );
    return { contactUserId: record.ownerUserId };
  });
}
