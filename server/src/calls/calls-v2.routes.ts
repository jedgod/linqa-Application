import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import type { CallService } from "../services/call.service.js";
import { CallTokenService, redactJoinToken } from "./call-token.service.js";

/**
 * Calls surface for the Calls home screen: paginated history, the next
 * scheduled call, call creation, and joining a scheduled call.
 *
 * The pack's client contract is honoured (`/v1/calls/history`,
 * `/v1/calls/upcoming`, `POST /v1/calls`, `.../join`) with two corrections:
 *
 *  - The caller is always the authenticated principal. `POST /v1/calls` takes
 *    a peer, never a "from" -- the pack's own security note says as much, and
 *    trusting a client-supplied initiator would let anyone place calls as
 *    anyone.
 *  - Every response that carries a join token also carries its expiry, and the
 *    token is never written to a log or an audit row in the clear.
 */

const HistoryQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().max(200).optional()
  })
  .strict();

const CreateCallBody = z
  .object({
    peerUserId: z.string().uuid(),
    media: z.enum(["AUDIO", "VIDEO"]).default("AUDIO"),
    privacyMode: z.enum(["STANDARD", "RELAY_ONLY"]).default("RELAY_ONLY")
  })
  .strict();

const limits = {
  history: simpleRateLimit({ windowMs: 60_000, max: 120, keyPrefix: "calls-history" }),
  create: simpleRateLimit({ windowMs: 60_000, max: 20, keyPrefix: "calls-create" }),
  join: simpleRateLimit({ windowMs: 60_000, max: 30, keyPrefix: "calls-join" })
};

/** How far either side of the scheduled start a call may be joined. */
const JOIN_OPENS_MS = 10 * 60_000;
const JOIN_CLOSES_MS = 60 * 60_000;

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

export async function registerCallsV2Routes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  calls: CallService
) {
  const authenticate = createAuthenticator(config);
  const tokens = new CallTokenService(config);

  const principalOf = async (request: FastifyRequest, reply: FastifyReply, scope: string) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, scope);
      return principal;
    } catch (error) {
      request.log.warn({ err: error }, "calls v2 authentication rejected");
      await reply.code(401).send({ error: { code: "UNAUTHENTICATED", requestId: request.id } });
      return null;
    }
  };

  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if ((error as { status?: number })?.status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", requestId: request.id } });
    }
    if (error instanceof z.ZodError) {
      return reply.code(422).send({ error: { code: "INVALID_REQUEST", requestId: request.id } });
    }
    request.log.error({ err: error }, "calls v2 request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", requestId: request.id } });
  };

  /**
   * Call history, newest first, keyset paginated.
   *
   * Peer country comes from the peer's own verified jurisdiction, which is the
   * only country fact the server actually holds; there is no IP geolocation
   * guess behind the flag on the row.
   */
  app.get("/v1/calls/history", async (request, reply) => {
    const principal = await principalOf(request, reply, "calls:read");
    if (!principal) return reply;
    try {
      limits.history(principal.userId, request);
      const query = HistoryQuery.parse(request.query ?? {});
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      if (query.cursor && !after) {
        return reply.code(422).send({ error: { code: "INVALID_CURSOR", requestId: request.id } });
      }

      const result = await db.query(
         `SELECT ch.id,
                ch.peer_user_id AS "peerUserId",
                ch.direction,
                ch.call_type AS "callType",
                ch.status,
                ch.duration_seconds AS "durationSeconds",
                ch.created_at AS "createdAt",
                COALESCE(p.display_name, 'Linqa user') AS "peerName",
                u.verified_country_code AS "peerCountryCode",
                c.name AS "peerCountryName"
           FROM call_history ch
           LEFT JOIN users u ON u.id = ch.peer_user_id
           LEFT JOIN user_profiles p ON p.user_id = ch.peer_user_id
           LEFT JOIN countries c ON c.code = u.verified_country_code
          WHERE ch.user_id = $1
            AND ($2::timestamptz IS NULL OR (ch.created_at, ch.id) < ($2::timestamptz, $3::uuid))
          ORDER BY ch.created_at DESC, ch.id DESC
          LIMIT $4`,
        [principal.userId, after?.createdAt ?? null, after?.id ?? null, query.limit]
      );

      const rows = result.rows as Array<{ id: string; createdAt: Date }>;
      const last = rows[rows.length - 1];
      void reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send({
        items: rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
        nextCursor:
          rows.length === query.limit && last
            ? encodeCursor(new Date(last.createdAt).toISOString(), last.id)
            : null
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  /**
   * The next scheduled call the caller is part of.
   *
   * `scheduled_calls.title_ciphertext` is encrypted and the server holds no
   * key, so no title is returned -- the client labels the card from the call
   * type, exactly as the Chats screen does.
   */
  app.get("/v1/calls/upcoming", async (request, reply) => {
    const principal = await principalOf(request, reply, "calls:read");
    if (!principal) return reply;
    try {
      const found = await db.query(
        `SELECT sc.id,
                sc.call_type AS "callType",
                sc.scheduled_for AS "startsAt",
                sc.privacy_mode AS "privacyMode",
                cardinality(sc.participant_user_ids) AS "participantCount"
           FROM scheduled_calls sc
          WHERE sc.status = 'SCHEDULED'
            AND sc.scheduled_for > now() - make_interval(secs => $2)
            AND (sc.organizer_user_id = $1 OR $1 = ANY(sc.participant_user_ids))
          ORDER BY sc.scheduled_for ASC
          LIMIT 1`,
        [principal.userId, JOIN_CLOSES_MS / 1000]
      );
      const row = found.rows[0] as
        | { id: string; callType: string; startsAt: Date; privacyMode: string; participantCount: number }
        | undefined;

      void reply.header("Cache-Control", "private, no-store");
      if (!row) return reply.code(200).send({ item: null });

      const startsAt = new Date(row.startsAt).getTime();
      const now = Date.now();
      return reply.code(200).send({
        item: {
          eventId: row.id,
          callType: row.callType,
          startsAt: new Date(row.startsAt).toISOString(),
          participantCount: Number(row.participantCount ?? 0),
          // Joinability is the server's answer, not a client clock comparison.
          joinable: now >= startsAt - JOIN_OPENS_MS && now <= startsAt + JOIN_CLOSES_MS
        }
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  /**
   * Places a call to a peer and returns a join token for the media plane.
   *
   * The initiator is the authenticated principal; the body carries only the
   * peer. Device resolution goes through `CallService`, which binds each
   * device to the user it is claimed for.
   */
  app.post("/v1/calls/place", async (request, reply) => {
    const principal = await principalOf(request, reply, "calls:write");
    if (!principal) return reply;
    if (!principal.deviceId) {
      return reply.code(403).send({ error: { code: "DEVICE_BOUND_TOKEN_REQUIRED", requestId: request.id } });
    }
    try {
      limits.create(principal.userId, request);
      const body = CreateCallBody.parse(request.body ?? {});
      if (body.peerUserId === principal.userId) {
        return reply.code(422).send({ error: { code: "SELF_CALL_NOT_ALLOWED", requestId: request.id } });
      }

      const blocked = await db.query(
        `SELECT 1 FROM blocked_users
          WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
             OR (blocker_user_id = $2 AND blocked_user_id = $1)`,
        [principal.userId, body.peerUserId]
      );
      if (blocked.rowCount) {
        // Same answer as an unreachable peer: whether you are blocked is not
        // something the blocked party gets to learn from a call attempt.
        return reply.code(409).send({ error: { code: "PEER_UNAVAILABLE", requestId: request.id } });
      }

      const peerDeviceId = await calls.resolveCallableDevice(body.peerUserId);
      if (!peerDeviceId) {
        return reply.code(409).send({ error: { code: "PEER_UNAVAILABLE", requestId: request.id } });
      }

      const session = await calls.create({
        initiatorUserId: principal.userId,
        initiatorDeviceId: principal.deviceId,
        recipientUserId: body.peerUserId,
        recipientDeviceId: peerDeviceId,
        callType: body.media,
        mode: "LIVE",
        privacyMode: body.privacyMode
      });
      const callId = session.callId;

      const issued = await tokens.issue({
        callId,
        userId: principal.userId,
        deviceId: principal.deviceId,
        callType: body.media,
        privacyMode: body.privacyMode
      });

      request.log.info(
        { callId, token: redactJoinToken(issued.joinToken) },
        "call join token issued"
      );
      return reply.code(201).send({
        callId,
        joinToken: issued.joinToken,
        expiresAt: issued.expiresAt,
        callType: body.media,
        privacyMode: body.privacyMode
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("inactive call participant")) {
        return reply.code(409).send({ error: { code: "PEER_UNAVAILABLE", requestId: request.id } });
      }
      return fail(request, reply, error);
    }
  });

  /**
   * Joins a scheduled call: verifies membership and the window, then mints the
   * same short-lived, call-scoped token as `place`.
   */
  app.post("/v1/calls/scheduled/:eventId/join-token", async (request, reply) => {
    const principal = await principalOf(request, reply, "calls:write");
    if (!principal) return reply;
    if (!principal.deviceId) {
      return reply.code(403).send({ error: { code: "DEVICE_BOUND_TOKEN_REQUIRED", requestId: request.id } });
    }
    try {
      limits.join(principal.userId, request);
      const params = z.object({ eventId: z.string().uuid() }).parse(request.params);

      const found = await db.query(
        `SELECT id, call_type AS "callType", scheduled_for AS "startsAt",
                privacy_mode AS "privacyMode", status
           FROM scheduled_calls
          WHERE id = $1 AND (organizer_user_id = $2 OR $2 = ANY(participant_user_ids))`,
        [params.eventId, principal.userId]
      );
      const event = found.rows[0] as
        | { id: string; callType: string; startsAt: Date; privacyMode: string; status: string }
        | undefined;
      // 404 for "not invited" as well as "does not exist", so this cannot be
      // used to discover other people's meetings.
      if (!event) {
        return reply.code(404).send({ error: { code: "EVENT_NOT_FOUND", requestId: request.id } });
      }

      const startsAt = new Date(event.startsAt).getTime();
      const now = Date.now();
      if (event.status !== "SCHEDULED" || now < startsAt - JOIN_OPENS_MS || now > startsAt + JOIN_CLOSES_MS) {
        return reply.code(409).send({ error: { code: "NOT_JOINABLE", requestId: request.id } });
      }

      const issued = await tokens.issue({
        callId: event.id,
        userId: principal.userId,
        deviceId: principal.deviceId,
        callType: event.callType,
        privacyMode: event.privacyMode
      });

      request.log.info(
        { eventId: event.id, token: redactJoinToken(issued.joinToken) },
        "scheduled call join token issued"
      );
      return reply.code(200).send({
        callId: event.id,
        joinToken: issued.joinToken,
        expiresAt: issued.expiresAt,
        callType: event.callType,
        privacyMode: event.privacyMode
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}
