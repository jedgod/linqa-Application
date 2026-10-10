import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { CallService } from "../services/call.service.js";
import type { LocationSharingService } from "../services/location-sharing.service.js";
import { createTurnCredentials } from "../calls/turn-credentials.js";

export async function registerCallRoutes(
  app: FastifyInstance,
  config: AppConfig,
  calls: CallService,
  location: LocationSharingService
) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/calls/turn-credentials", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");
      return createTurnCredentials({
        secret: config.TURN_SHARED_SECRET,
        userId: principal.userId,
        ttlSeconds: 600,
        urls: config.TURN_URLS
      });
    } catch (error) {
      request.log.warn({ err: error }, "TURN credential request rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.post("/v1/calls", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        recipientUserId: z.string().uuid(),
        // Optional: a caller has no way to know the callee's device ids, and
        // exposing them would let anyone enumerate another user's devices. When
        // omitted the server rings the callee's most recently active device.
        recipientDeviceId: z.string().uuid().optional(),
        callType: z.enum(["AUDIO", "VIDEO", "SCREEN_SHARE"]),
        mode: z.enum(["LIVE", "RECORDED_RESPONSE"]).default("LIVE"),
        privacyMode: z.enum(["STANDARD", "RELAY_ONLY"]).default("RELAY_ONLY")
      }).parse(request.body);

      if (body.recipientUserId === principal.userId) {
        return reply.code(400).send({ error: "cannot_call_self" });
      }

      const recipientDeviceId =
        body.recipientDeviceId ?? (await calls.resolveCallableDevice(body.recipientUserId));
      if (!recipientDeviceId) {
        // Distinct from a generic invalid_request: the callee simply has no
        // device that can ring, and the client should say so.
        return reply.code(409).send({ error: "recipient_has_no_active_device" });
      }

      const call = await calls.create({
        initiatorUserId: principal.userId,
        initiatorDeviceId: principal.deviceId,
        recipientUserId: body.recipientUserId,
        recipientDeviceId,
        callType: body.callType,
        mode: body.mode,
        privacyMode: body.privacyMode
      });

      return reply.code(201).send(call);
    } catch (error) {
      request.log.warn({ err: error }, "call creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/calls/scheduled", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:read");
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
        .parse(request.query ?? {});
      return { scheduled: await calls.listScheduled(principal.userId, query.limit) };
    } catch (error) {
      request.log.warn({ err: error }, "scheduled call list rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/calls/scheduled/:scheduledCallId/cancel", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:schedule");
      const params = z.object({ scheduledCallId: z.string().uuid() }).parse(request.params);

      const cancelled = await calls.cancelScheduled(params.scheduledCallId, principal.userId);
      if (!cancelled) {
        // Same answer whether the id does not exist, belongs to someone else,
        // or is already cancelled -- so this cannot be used to probe for ids.
        return reply.code(404).send({ error: "scheduled_call_not_found" });
      }
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "scheduled call cancel rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/calls/:callId/end", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params = z.object({ callId: z.string().uuid() }).parse(request.params);
      const body = z.object({ reason: z.enum(["REJECTED", "FAILED"]).optional() }).default({}).parse(request.body ?? {});
      await calls.end(params.callId, principal.deviceId, body.reason);

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "call end rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/calls/:callId/location-grants", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params = z.object({ callId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        mode: z.enum(["CITY", "APPROXIMATE", "PRECISE"]),
        scope: z.enum(["CALL_ONLY", "MINUTES_15", "HOUR_1"]),
        foregroundOnly: z.boolean().default(true)
      }).parse(request.body);

      const grant = await location.grant({
        callId: params.callId,
        userId: principal.userId,
        deviceId: principal.deviceId,
        mode: body.mode,
        scope: body.scope,
        foregroundOnly: body.foregroundOnly
      });

      return reply.code(201).send(grant);
    } catch (error) {
      request.log.warn({ err: error }, "location grant rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/calls/:callId/location-events", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params = z.object({ callId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        ciphertextBase64: z.string().min(24),
        capturedAt: z.string().datetime(),
        expiresAt: z.string().datetime()
      }).parse(request.body);

      const result = await location.publishEncryptedLocation({
        callId: params.callId,
        deviceId: principal.deviceId,
        ciphertext: Buffer.from(body.ciphertextBase64, "base64"),
        capturedAt: new Date(body.capturedAt),
        expiresAt: new Date(body.expiresAt)
      });

      return reply.code(201).send(result);
    } catch (error) {
      request.log.warn({ err: error }, "location event publish rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  // Lets the other participant on a call read back the ciphertext the
  // sharing side already publishes via POST .../location-events — without
  // this, a call's shared location could never actually be shown to anyone.
  app.get("/v1/calls/:callId/location-events", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params = z.object({ callId: z.string().uuid() }).parse(request.params);
      const query = z.object({
        afterSequence: z.coerce.number().int().min(0).default(0)
      }).parse(request.query);

      const events = await location.listEvents({
        callId: params.callId,
        userId: principal.userId,
        deviceId: principal.deviceId,
        afterSequence: query.afterSequence
      });

      return {
        events: events.map((row) => ({
          sequence: Number(row.sequence),
          senderDeviceId: row.sender_device_id,
          ciphertextBase64: (row.ciphertext as Buffer).toString("base64"),
          capturedAt: row.captured_at,
          expiresAt: row.expires_at
        }))
      };
    } catch (error) {
      request.log.warn({ err: error }, "location event list rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/calls/:callId/location-grants/revoke", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params = z.object({ callId: z.string().uuid() }).parse(request.params);
      await location.revoke(params.callId, principal.deviceId);

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "location grant revocation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
