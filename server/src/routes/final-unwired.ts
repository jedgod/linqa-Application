import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { ServiceContainer } from "../bootstrap/service-container.js";

export async function registerFinalUnwiredRoutes(
  app: FastifyInstance,
  config: AppConfig,
  services: ServiceContainer
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/groups/:groupId/state", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "groups:write");
    if (!principal.deviceId) {
      return reply.code(401).send({ error: "device_bound_token_required" });
    }
    const params = z.object({ groupId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      epoch: z.number().int().positive(),
      stateCiphertextBase64: z.string().min(24),
      stateHashBase64: z.string().min(40),
      previousStateHashBase64: z.string().min(40).nullable()
    }).parse(request.body);

    await services.groups.appendState({
      groupId: params.groupId,
      signerDeviceId: principal.deviceId,
      epoch: body.epoch,
      stateCiphertext: Buffer.from(body.stateCiphertextBase64, "base64"),
      stateHash: Buffer.from(body.stateHashBase64, "base64"),
      previousStateHash: body.previousStateHashBase64
        ? Buffer.from(body.previousStateHashBase64, "base64")
        : null
    });
    return reply.code(202).send({ accepted: true });
  });

  app.post("/v1/security/network-risk/evaluate", async (request) => {
    const principal = await authenticate(request);
    requireScope(principal, "security:risk");
    if (!principal.deviceId) throw new Error("device-bound token required");
    const body = z.object({
      isVpn: z.boolean(),
      isProxy: z.boolean(),
      countryCode: z.string().length(2).optional(),
      asn: z.string().max(32).optional(),
      previousCountryCode: z.string().length(2).optional(),
      previousAsn: z.string().max(32).optional(),
      distanceKm: z.number().nonnegative().optional(),
      elapsedMinutes: z.number().nonnegative().optional()
    }).parse(request.body);
    const optionalRiskFields = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined)
    );
    return services.networkRisk.evaluate({
      userId: principal.userId,
      deviceId: principal.deviceId,
      isVpn: body.isVpn,
      isProxy: body.isProxy,
      ...optionalRiskFields
    });
  });

  app.get("/v1/security/device-integrity/current", async (request) => {
    const principal = await authenticate(request);
    requireScope(principal, "security:integrity");
    if (!principal.deviceId) throw new Error("device-bound token required");
    return services.accountIntegrity.evaluateDevice(principal.deviceId);
  });

  app.post("/v1/messages/:messageId/expiry-receipts", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "messages:receive");
    if (!principal.deviceId) throw new Error("device-bound token required");
    const params = z.object({ messageId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      receiptType: z.enum([
        "SCHEDULED",
        "EXPIRED_LOCAL",
        "DELETED_REMOTE",
        "FAILED"
      ])
    }).parse(request.body);
    await services.disappearingMessages.recordReceipt({
      messageId: params.messageId,
      deviceId: principal.deviceId,
      receiptType: body.receiptType
    });
    return reply.code(204).send();
  });
}