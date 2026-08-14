import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { DeviceRepository } from "../repositories/device.repository.js";
import { RelayRepository } from "../repositories/relay.repository.js";
import type { RealtimeHub } from "../realtime/hub.js";

const SubmitSchema = z.object({
  recipientDeviceId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  ciphertextBase64: z.string().min(24),
  expiresAt: z.string().datetime().optional()
});

const AckSchema = z.object({
  leaseOwner: z.string().uuid(),
  envelopeIds: z.array(z.string().uuid()).min(1).max(500)
});

export async function registerRelayRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  hub?: RealtimeHub
) {
  const authenticate = createAuthenticator(config);
  const devices = new DeviceRepository(db);
  const relay = new RelayRepository(db);

  app.post("/v1/relay/envelopes", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "messages:send");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const sender = await devices.findActive(principal.deviceId, principal.userId);
      if (!sender) {
        return reply.code(403).send({ error: "sender_device_inactive" });
      }

      const rawBody = request.body as Record<string, unknown> | null;
      if (rawBody && ["plaintext", "body", "text"].some((key) => key in rawBody)) {
        return reply.code(400).send({ error: "plaintext_messages_forbidden" });
      }
      const body = SubmitSchema.strict().parse(request.body);
      const recipient = await devices.findActive(body.recipientDeviceId);
      if (!recipient) {
        return reply.code(404).send({ error: "recipient_device_not_found" });
      }

      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.ciphertextBase64) || body.ciphertextBase64.length % 4 !== 0) {
        return reply.code(400).send({ error: "invalid_ciphertext_encoding" });
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

      if (stored.inserted) {
        hub?.notifyEnvelopeAvailable(body.recipientDeviceId, Number(stored.server_sequence));
      }

      return reply.code(stored.inserted ? 201 : 200).send({
        envelopeId: stored.id,
        serverSequence: stored.server_sequence,
        acceptedAt: stored.accepted_at,
        idempotentReplay: !stored.inserted
      });
    } catch (error) {
      request.log.warn({ err: error }, "envelope submission rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/relay/envelopes", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "messages:receive");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

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

      return {
        leaseOwner: leased.leaseOwner,
        leaseExpiresInSeconds: config.DELIVERY_LEASE_SECONDS,
        envelopes: leased.envelopes.map((row) => ({
          id: row.id,
          senderDeviceId: row.sender_device_id,
          senderSigningPublicKeyBase64: (row.sender_signing_public_key as Buffer).toString("base64"),
          clientMessageId: row.client_message_id,
          ciphertextBase64: (row.ciphertext as Buffer).toString("base64"),
          serverSequence: row.server_sequence,
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

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = AckSchema.parse(request.body);
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
