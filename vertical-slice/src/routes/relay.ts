import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { DeviceRepository } from "../repositories/device.repository.js";
import { RelayRepository } from "../repositories/relay.repository.js";
import type { RealtimeHub } from "../realtime/hub.js";

export async function registerRelayRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  hub: RealtimeHub
) {
  const authenticate = createAuthenticator(config);
  const devices = new DeviceRepository(db);
  const relay = new RelayRepository(db);

  app.post("/v1/relay/envelopes", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "messages:send");

      const sender = await devices.findActive(principal.deviceId, principal.userId);
      if (!sender) {
        return reply.code(403).send({ error: "sender_device_inactive" });
      }

      const body = z.object({
        recipientDeviceId: z.string().uuid(),
        clientMessageId: z.string().uuid(),
        ciphertextBase64: z.string().min(24),
        expiresAt: z.string().datetime().optional()
      }).parse(request.body);

      const recipient = await devices.findActive(body.recipientDeviceId);
      if (!recipient) {
        return reply.code(404).send({ error: "recipient_device_not_found" });
      }

      const ciphertext = Buffer.from(body.ciphertextBase64, "base64");
      if (ciphertext.length < 16 || ciphertext.length > config.MAX_ENVELOPE_BYTES) {
        return reply.code(413).send({ error: "invalid_envelope_size" });
      }

      const maximumExpiry = Date.now() + config.ENVELOPE_TTL_SECONDS * 1000;
      const requestedExpiry = body.expiresAt
        ? new Date(body.expiresAt).getTime()
        : maximumExpiry;
      const expiresAt = new Date(Math.min(requestedExpiry, maximumExpiry));

      if (expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "envelope_already_expired" });
      }

      const stored = await relay.store({
        senderDeviceId: principal.deviceId,
        recipientDeviceId: body.recipientDeviceId,
        clientMessageId: body.clientMessageId,
        ciphertext,
        expiresAt
      });

      await devices.touch(principal.deviceId);

      if (stored.inserted) {
        hub.notify(body.recipientDeviceId, Number(stored.server_sequence));
      }

      return reply.code(stored.inserted ? 201 : 200).send({
        envelopeId: stored.id,
        serverSequence: Number(stored.server_sequence),
        acceptedAt: stored.accepted_at,
        idempotentReplay: !stored.inserted
      });
    } catch (error) {
      request.log.warn({ err: error }, "envelope submit rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/relay/envelopes", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "messages:receive");

      const device = await devices.findActive(principal.deviceId, principal.userId);
      if (!device) {
        return reply.code(403).send({ error: "recipient_device_inactive" });
      }

      const query = z.object({
        limit: z.coerce.number().int().min(1).max(500).default(100)
      }).parse(request.query);

      const leased = await relay.lease(
        principal.deviceId,
        query.limit,
        config.DELIVERY_LEASE_SECONDS
      );

      await devices.touch(principal.deviceId);

      return {
        leaseOwner: leased.leaseOwner,
        leaseExpiresInSeconds: config.DELIVERY_LEASE_SECONDS,
        envelopes: leased.envelopes.map((row) => ({
          id: row.id,
          senderDeviceId: row.sender_device_id,
          clientMessageId: row.client_message_id,
          ciphertextBase64: (row.ciphertext as Buffer).toString("base64"),
          serverSequence: Number(row.server_sequence),
          acceptedAt: row.accepted_at,
          expiresAt: row.expires_at
        }))
      };
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/relay/acknowledgements", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "messages:receive");

      const body = z.object({
        leaseOwner: z.string().uuid(),
        envelopeIds: z.array(z.string().uuid()).min(1).max(500)
      }).parse(request.body);

      const acknowledged = await relay.acknowledge(
        principal.deviceId,
        body.leaseOwner,
        body.envelopeIds
      );

      return { acknowledged };
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
