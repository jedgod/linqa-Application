import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { SessionService } from "../services/session.service.js";
import { DeviceLinkError, DeviceLinkService, mayUnlink } from "./device-links.service.js";

const limits = {
  create: simpleRateLimit({ windowMs: 60_000, max: 12, keyPrefix: "link-create" }),
  poll: simpleRateLimit({ windowMs: 60_000, max: 90, keyPrefix: "link-poll" }),
  act: simpleRateLimit({ windowMs: 60_000, max: 30, keyPrefix: "link-act" })
};

const Secret = z.object({ secret: z.string().min(20).max(100) }).strict();
const Params = z.object({ linkId: z.string().uuid() });

const STATUS: Record<DeviceLinkError["code"], number> = {
  LINK_NOT_FOUND: 404, LINK_EXPIRED: 410, LINK_NOT_PENDING: 409, LINK_NOT_APPROVED: 409, LINK_ALREADY_USED: 409, INVALID_REQUEST: 422
};

/**
 * Link a computer by QR. The computer-side calls (create, status, claim) are unauthenticated: the one-time secret is the
 * credential. The phone-side calls (preview, approve, deny) need a signed-in enrolled device.
 */
export async function registerDeviceLinkRoutes(app: FastifyInstance, config: AppConfig, db: Database, sessions: SessionService, hub?: RealtimeHub) {
  const service = new DeviceLinkService(db, sessions);
  const authenticate = createAuthenticator(config);

  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if ((error as { status?: number })?.status === 429) return reply.code(429).send({ error: { code: "RATE_LIMITED" } });
    if (error instanceof DeviceLinkError) return reply.code(STATUS[error.code]).send({ error: { code: error.code } });
    if (error instanceof z.ZodError) return reply.code(422).send({ error: { code: "INVALID_REQUEST" } });
    request.log.error({ err: error }, "device link request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR" } });
  };
  const ipKey = (request: FastifyRequest) => request.ip || "unknown";
  const phone = async (request: FastifyRequest) => {
    const principal = await authenticate(request);
    requireScope(principal, "devices:write");
    if (!principal.deviceId) throw new DeviceLinkError("INVALID_REQUEST");
    return principal;
  };

  app.post("/v1/device-links", async (request, reply) => {
    try {
      limits.create(ipKey(request), request);
      const body = z.object({ deviceName: z.string().trim().min(1).max(100), platform: z.enum(["WEB", "DESKTOP"]) }).strict().parse(request.body ?? {});
      const created = await service.create(body);
      void reply.header("Cache-Control", "no-store");
      return reply.code(201).send({ linkId: created.linkId, secret: created.secret, expiresAt: created.expiresAt.toISOString() });
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/device-links/:linkId/status", async (request, reply) => {
    try {
      limits.poll(ipKey(request), request);
      const { linkId } = Params.parse(request.params);
      const { secret } = Secret.parse(request.body ?? {});
      void reply.header("Cache-Control", "no-store");
      return reply.code(200).send(await service.status(linkId, secret));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/device-links/:linkId/claim", async (request, reply) => {
    try {
      limits.act(ipKey(request), request);
      const { linkId } = Params.parse(request.params);
      const { secret } = Secret.parse(request.body ?? {});
      void reply.header("Cache-Control", "no-store");
      return reply.code(200).send({ session: await service.claim(linkId, secret) });
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/device-links/:linkId/preview", async (request, reply) => {
    try {
      const principal = await phone(request);
      limits.act(principal.userId, request);
      const { linkId } = Params.parse(request.params);
      const { secret } = Secret.parse(request.body ?? {});
      return reply.code(200).send(await service.preview(linkId, secret));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/device-links/:linkId/approve", async (request, reply) => {
    try {
      const principal = await phone(request);
      limits.act(principal.userId, request);
      const { linkId } = Params.parse(request.params);
      const { secret } = Secret.parse(request.body ?? {});
      await service.approve(linkId, secret, principal.userId, principal.deviceId ?? null);
      request.log.info({ userId: principal.userId, linkId }, "device link approved");
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/device-links/:linkId/deny", async (request, reply) => {
    try {
      const principal = await phone(request);
      limits.act(principal.userId, request);
      const { linkId } = Params.parse(request.params);
      const { secret } = Secret.parse(request.body ?? {});
      await service.deny(linkId, secret);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  /** The account's devices, so a person can see what is linked. */
  app.get("/v1/devices", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "devices:read");
      const result = await db.query(
        `SELECT id, device_name AS "deviceName", platform, registered_at AS "registeredAt", last_seen_at AS "lastSeenAt"
           FROM devices WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY registered_at DESC NULLS LAST LIMIT 50`,
        [principal.userId]
      );
      void reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send({ devices: result.rows.map((row) => ({ ...row, current: row.id === principal.deviceId })) });
    } catch (error) { return fail(request, reply, error); }
  });

  /** Unlink a device: it can no longer sign in, and anything it is connected with is dropped now. Not allowed on the device you are using. */
  app.post("/v1/devices/:deviceId/unlink", async (request, reply) => {
    try {
      const principal = await phone(request);
      limits.act(principal.userId, request);
      const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
      if (deviceId === principal.deviceId) return reply.code(409).send({ error: { code: "CANNOT_UNLINK_THIS_DEVICE" } });
      const platforms = await db.query(`SELECT id, platform FROM devices WHERE id = ANY($1::uuid[]) AND user_id = $2 AND status = 'ACTIVE'`, [[deviceId, principal.deviceId], principal.userId]);
      const platformOf = (id: string) => (platforms.rows.find((row) => row.id === id)?.platform as string | undefined) ?? "";
      if (!platformOf(deviceId)) return reply.code(404).send({ error: { code: "DEVICE_NOT_FOUND" } });
      if (!mayUnlink(platformOf(principal.deviceId!), platformOf(deviceId))) return reply.code(403).send({ error: { code: "PHONE_REQUIRED" } });
      const revoked = await db.query(
        `UPDATE devices SET status = 'REVOKED', revoked_at = now() WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE' RETURNING id`,
        [deviceId, principal.userId]
      );
      if (revoked.rowCount !== 1) return reply.code(404).send({ error: { code: "DEVICE_NOT_FOUND" } });
      await db.query(
        `UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'DEVICE_UNLINKED' WHERE device_id = $1 AND revoked_at IS NULL`,
        [deviceId]
      );
      hub?.disconnectDevice(deviceId, 4003, "device unlinked");
      request.log.info({ userId: principal.userId, deviceId }, "device unlinked");
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });
}
