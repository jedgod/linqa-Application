import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import type { RealtimeHub } from "../realtime/hub.js";
import {
  ChatError,
  appendOutbox,
  assertMember,
  issueContactQrToken,
  listMessages,
  markConversationRead,
  redeemContactQrToken,
  resolveDirectConversation,
  sendMessage,
  withTransaction
} from "./chat.service.js";
import { publishOutboxBatch } from "./chat-outbox.service.js";
import type { ChatBus } from "./chat-redis-bus.js";

/**
 * Chat v2: conversations, messages, read state, scheduled-call join, QR
 * contact exchange and broadcasts.
 *
 * Every handler follows the same shape: authenticate, rate limit, validate
 * with a strict schema, then do the work behind a membership check. The error
 * mapper at the bottom is the only thing that turns a failure into a response,
 * so a stack trace or a driver message cannot escape by accident.
 */

// `.strict()` throughout: an unknown key is a client/server disagreement, and
// silently ignoring it is how a "muted": true that the server never reads ends
// up looking like it worked.
const DirectBody = z.object({ userId: z.string().uuid() }).strict();

const MessageBody = z
  .object({
    clientMessageId: z.string().uuid(),
    kind: z.enum(["TEXT", "VOICE", "PHOTOS", "CALL", "SYSTEM"]),
    ciphertext: z.string().max(90_000).optional(),
    mediaCount: z.number().int().min(0).max(20).default(0),
    replyToId: z.string().uuid().optional()
  })
  .strict();

const MessagePageQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().max(200).optional() })
  .strict();

const RedeemQrBody = z.object({ token: z.string().min(16).max(256) }).strict();

const BroadcastBody = z
  .object({
    clientRequestId: z.string().uuid(),
    ciphertext: z.string().min(1).max(90_000),
    recipientIds: z.array(z.string().uuid()).min(1).max(500),
    scheduledAt: z.string().datetime().optional()
  })
  .strict();

/** Rate limits from the pack's security checklist, enforced rather than documented. */
const limits = {
  messages: simpleRateLimit({ windowMs: 60_000, max: 60, keyPrefix: "chat-messages" }),
  read: simpleRateLimit({ windowMs: 60_000, max: 240, keyPrefix: "chat-read" }),
  direct: simpleRateLimit({ windowMs: 60_000, max: 20, keyPrefix: "chat-direct" }),
  page: simpleRateLimit({ windowMs: 60_000, max: 120, keyPrefix: "chat-page" }),
  qrCreate: simpleRateLimit({ windowMs: 3_600_000, max: 10, keyPrefix: "chat-qr-create" }),
  qrRedeem: simpleRateLimit({ windowMs: 3_600_000, max: 30, keyPrefix: "chat-qr-redeem" }),
  broadcast: simpleRateLimit({ windowMs: 86_400_000, max: 10, keyPrefix: "chat-broadcast" })
};

const QR_TOKEN_TTL_SECONDS = 300;
/** How long after the scheduled start a call stays joinable. */
const JOIN_WINDOW_BEFORE_MS = 10 * 60_000;
const JOIN_WINDOW_AFTER_MS = 60 * 60_000;

function ipHash(request: FastifyRequest): Buffer {
  return createHash("sha256").update(String(request.ip ?? ""), "utf8").digest();
}

export async function registerChatV2Routes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  hub: RealtimeHub,
  bus?: ChatBus
) {
  const authenticate = createAuthenticator(config);

  const principalOf = async (request: FastifyRequest, reply: FastifyReply, scope: string) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, scope);
      return principal;
    } catch (error) {
      request.log.warn({ err: error }, "chat v2 authentication rejected");
      await reply.code(401).send({ error: { code: "UNAUTHENTICATED", requestId: request.id } });
      return null;
    }
  };

  /**
   * The single place a thrown error becomes a response.
   *
   * Anything that is not a deliberate `ChatError` is logged in full and
   * answered with an opaque 500 -- no stack, no SQL, no hostname, per the
   * pack's error envelope.
   */
  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if (error instanceof ChatError) {
      return reply.code(error.status).send({ error: { code: error.code, requestId: request.id } });
    }
    const status = (error as { status?: number })?.status;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", requestId: request.id } });
    }
    request.log.error({ err: error }, "chat v2 request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", requestId: request.id } });
  };

  const audit = async (
    request: FastifyRequest,
    actorUserId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Record<string, unknown> = {}
  ) => {
    try {
      await db.query(
        `INSERT INTO chat_security_audit
           (actor_user_id, action, resource_type, resource_id, request_id, ip_hash, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [actorUserId, action, resourceType, resourceId, String(request.id), ipHash(request), JSON.stringify(metadata)]
      );
    } catch (error) {
      // An audit write must never fail the user's request, but it must be
      // visible when it breaks.
      request.log.error({ err: error, action }, "chat security audit write failed");
    }
  };

  /**
   * Pushes freshly committed events to connected devices.
   *
   * Called after COMMIT, never inside the transaction: publishing first would
   * announce a message that a later rollback erases.
   */
  const flush = (request: FastifyRequest) => {
    void publishOutboxBatch(db, hub, 100, bus).catch((error) => {
      request.log.warn({ err: error }, "chat outbox flush failed; relay will retry");
    });
  };

  // -------------------------------------------------------------------------
  // Conversations and messages
  // -------------------------------------------------------------------------

  app.post("/v1/chats/direct", async (request, reply) => {
    const principal = await principalOf(request, reply, "messages:send");
    if (!principal) return reply;
    try {
      limits.direct(principal.userId, request);
      const body = DirectBody.parse(request.body ?? {});
      const result = await resolveDirectConversation(db, principal.userId, body.userId);
      await audit(request, principal.userId, "chat.direct.resolve", "conversation", result.conversationId, {
        created: result.created
      });
      return reply.code(result.created ? 201 : 200).send({ conversationId: result.conversationId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_BODY", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  app.post("/v1/chats/:conversationId/messages", async (request, reply) => {
    const principal = await principalOf(request, reply, "messages:send");
    if (!principal) return reply;
    try {
      limits.messages(principal.userId, request);
      const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
      const body = MessageBody.parse(request.body ?? {});

      const message = await sendMessage(db, {
        conversationId: params.conversationId,
        senderUserId: principal.userId,
        senderDeviceId: principal.deviceId,
        clientMessageId: body.clientMessageId,
        kind: body.kind,
        ciphertextBase64: body.ciphertext,
        mediaCount: body.mediaCount,
        replyToId: body.replyToId
      });

      if (!message.duplicate) flush(request);
      // A retry answers 200 with the original message; only the write that
      // actually created something answers 201.
      return reply.code(message.duplicate ? 200 : 201).send(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_BODY", requestId: request.id } });
      }
      // The reply-target trigger surfaces as a check violation.
      if ((error as { code?: string })?.code === "23514") {
        return reply.code(422).send({ error: { code: "INVALID_REPLY_TARGET", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  app.get("/v1/chats/:conversationId/messages", async (request, reply) => {
    const principal = await principalOf(request, reply, "messages:read");
    if (!principal) return reply;
    try {
      limits.page(principal.userId, request);
      const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
      const query = MessagePageQuery.parse(request.query ?? {});
      const page = await listMessages(
        db,
        principal.userId,
        params.conversationId,
        query.limit,
        query.cursor
      );
      void reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send(page);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_QUERY", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  app.post("/v1/chats/:conversationId/read-state", async (request, reply) => {
    const principal = await principalOf(request, reply, "messages:read");
    if (!principal) return reply;
    try {
      limits.read(principal.userId, request);
      const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
      const result = await markConversationRead(db, principal.userId, params.conversationId);
      flush(request);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_CONVERSATION_ID", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  // -------------------------------------------------------------------------
  // Scheduled call join
  // -------------------------------------------------------------------------

  app.post("/v1/chats/scheduled-calls/:eventId/join", async (request, reply) => {
    const principal = await principalOf(request, reply, "calls:write");
    if (!principal) return reply;
    try {
      const params = z.object({ eventId: z.string().uuid() }).parse(request.params);
      const found = await db.query(
        `SELECT id, call_type AS "callType", scheduled_for AS "scheduledFor", status
           FROM scheduled_calls
          WHERE id = $1
            AND (organizer_user_id = $2 OR $2 = ANY(participant_user_ids))`,
        [params.eventId, principal.userId]
      );
      const event = found.rows[0] as
        | { id: string; callType: string; scheduledFor: Date; status: string }
        | undefined;
      if (!event) {
        await audit(request, principal.userId, "chat.call.join.denied", "scheduled_call", params.eventId);
        return reply.code(404).send({ error: { code: "EVENT_NOT_FOUND", requestId: request.id } });
      }

      const startsAt = new Date(event.scheduledFor).getTime();
      const now = Date.now();
      // The pack only checks the lower bound, which leaves a call scheduled a
      // year ago and never started permanently joinable. Both ends are closed.
      const joinable =
        event.status === "SCHEDULED" &&
        now >= startsAt - JOIN_WINDOW_BEFORE_MS &&
        now <= startsAt + JOIN_WINDOW_AFTER_MS;
      if (!joinable) {
        return reply.code(409).send({ error: { code: "NOT_JOINABLE", requestId: request.id } });
      }

      await audit(request, principal.userId, "chat.call.join", "scheduled_call", event.id);
      // No join token is minted here: issuing call credentials belongs to the
      // call service, which owns TURN and the E2EE capability check. This
      // endpoint answers *whether* the caller may join, and the client then
      // goes through the existing authorized call path.
      return reply.code(200).send({ eventId: event.id, callType: event.callType, joinable: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_EVENT_ID", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  // -------------------------------------------------------------------------
  // QR contact exchange
  // -------------------------------------------------------------------------

  app.post("/v1/contacts/qr", async (request, reply) => {
    const principal = await principalOf(request, reply, "contacts:write");
    if (!principal) return reply;
    try {
      limits.qrCreate(principal.userId, request);
      const issued = await issueContactQrToken(db, principal.userId, QR_TOKEN_TTL_SECONDS);
      await audit(request, principal.userId, "chat.qr.issue", "contact_qr_token", null);
      // The payload is an opaque bearer token and nothing else -- no user id,
      // no display name, no phone number. Anyone photographing the code off a
      // screen gets a string that expires in five minutes and works once.
      return reply.code(201).send({
        qrPayload: `linqa://contact?v=1&t=${issued.token}`,
        expiresAt: issued.expiresAt
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post("/v1/contacts/qr/redeem", async (request, reply) => {
    const principal = await principalOf(request, reply, "contacts:write");
    if (!principal) return reply;
    try {
      limits.qrRedeem(principal.userId, request);
      const body = RedeemQrBody.parse(request.body ?? {});
      const result = await redeemContactQrToken(db, principal.userId, body.token);
      await audit(request, principal.userId, "chat.qr.redeem", "user", result.contactUserId);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_BODY", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  // -------------------------------------------------------------------------
  // Broadcasts
  // -------------------------------------------------------------------------

  app.post("/v1/chats/broadcasts", async (request, reply) => {
    const principal = await principalOf(request, reply, "messages:send");
    if (!principal) return reply;
    try {
      limits.broadcast(principal.userId, request);
      const body = BroadcastBody.parse(request.body ?? {});
      const uniqueRecipients = [...new Set(body.recipientIds)];
      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
        return reply.code(422).send({ error: { code: "SCHEDULE_IN_PAST", requestId: request.id } });
      }

      // Binds the idempotency key to what it was issued for, so a retry that
      // reuses the key with a different body is rejected instead of silently
      // returning the first campaign and dropping the new message.
      const fingerprint = createHash("sha256")
        .update(body.ciphertext)
        .update(" ")
        .update(uniqueRecipients.slice().sort().join(","))
        .digest();

      const campaign = await withTransaction(db, async (client) => {
        const allowed = await client.query(
          `SELECT contact_user_id AS id FROM chat_contacts
            WHERE owner_user_id = $1 AND contact_user_id = ANY($2::uuid[])`,
          [principal.userId, uniqueRecipients]
        );
        // Broadcast reaches contacts only. Comparing against the *deduplicated*
        // set matters: comparing against the raw array would let a caller pad
        // the list with repeats to make the counts line up.
        if (allowed.rowCount !== uniqueRecipients.length) {
          throw new ChatError(422, "RECIPIENT_NOT_A_CONTACT");
        }

        const existing = await client.query(
          `SELECT id, state::text AS state, request_fingerprint AS "fingerprint"
             FROM broadcast_campaigns WHERE created_by = $1 AND client_request_id = $2`,
          [principal.userId, body.clientRequestId]
        );
        if (existing.rowCount) {
          const row = existing.rows[0] as { id: string; state: string; fingerprint: Buffer };
          if (!row.fingerprint.equals(fingerprint)) {
            throw new ChatError(409, "IDEMPOTENCY_KEY_REUSED");
          }
          return { id: row.id, state: row.state, replayed: true };
        }

        const created = await client.query(
          `INSERT INTO broadcast_campaigns
             (created_by, body_ciphertext, scheduled_at, state, client_request_id,
              request_fingerprint, recipient_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, state::text AS state`,
          [
            principal.userId,
            Buffer.from(body.ciphertext, "base64"),
            scheduledAt,
            scheduledAt ? "SCHEDULED" : "PROCESSING",
            body.clientRequestId,
            fingerprint,
            uniqueRecipients.length
          ]
        );
        const row = created.rows[0] as { id: string; state: string };

        await client.query(
          `INSERT INTO broadcast_recipients (campaign_id, recipient_user_id)
           SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [row.id, uniqueRecipients]
        );
        await client.query(
          `INSERT INTO chat_delivery_jobs (job_type, dedupe_key, payload, run_at)
           VALUES ('broadcast.deliver', $1, $2::jsonb, COALESCE($3, now()))
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [`broadcast:${row.id}`, JSON.stringify({ campaignId: row.id }), scheduledAt]
        );
        return { ...row, replayed: false };
      });

      await audit(request, principal.userId, "chat.broadcast.create", "broadcast_campaign", campaign.id, {
        recipients: uniqueRecipients.length,
        replayed: campaign.replayed
      });
      return reply.code(202).send({ campaignId: campaign.id, state: campaign.state });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_BODY", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  // -------------------------------------------------------------------------
  // Durable event replay
  // -------------------------------------------------------------------------

  app.get("/v1/chats/:conversationId/events", async (request, reply) => {
    const principal = await principalOf(request, reply, "messages:read");
    if (!principal) return reply;
    try {
      limits.page(principal.userId, request);
      const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
      const query = z
        .object({
          afterEventId: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(200).default(100)
        })
        .strict()
        .parse(request.query ?? {});

      const events = await withTransaction(db, async (client) => {
        await assertMember(client, principal.userId, params.conversationId);
        const result = await client.query(
          `SELECT id AS "eventId", topic AS type, payload, created_at AS "occurredAt"
             FROM chat_outbox
            WHERE conversation_id = $1 AND id > $2
            ORDER BY id ASC LIMIT $3`,
          [params.conversationId, query.afterEventId, query.limit]
        );
        return result.rows as Array<{ eventId: string; type: string; payload: unknown; occurredAt: Date }>;
      });

      void reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send({
        events: events.map((event) => ({
          eventId: Number(event.eventId),
          type: event.type,
          conversationId: params.conversationId,
          occurredAt: new Date(event.occurredAt).toISOString(),
          payload: event.payload
        }))
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: { code: "INVALID_QUERY", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  // Exposed for the worker's system messages; keeps the outbox append in one
  // place rather than duplicating the insert.
  void appendOutbox;
}
