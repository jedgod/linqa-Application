import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { AppConfig } from "../config.js";
import type { PhoneFirstRegistrationService } from "../services/phone-first-registration.service.js";
import type { AccountSwitchV3Service } from "../services/account-switch-v3.service.js";

function expectedError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "invalid_request";
  const status = code === "ACCOUNT_LIMIT_REACHED" ? 409
    : code.includes("already_registered") ? 409
      : code.includes("required") || code.includes("unavailable") ? 403
        : 400;
  return reply.code(status).send({ error: code });
}

export async function registerPhoneFirstRoutes(
  app: FastifyInstance,
  config: AppConfig,
  services: { registration: PhoneFirstRegistrationService; switcher: AccountSwitchV3Service }
) {
  const authenticate = createAuthenticator(config);

  app.post("/v6/registration/start", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:write");
      const body = z.object({
        installationId: z.string().uuid(),
        detectedCountryIso2: z.string().length(2).optional()
      }).parse(request.body);
      return reply.code(201).send(await services.registration.start({
        installationId: body.installationId,
        userId: principal.userId,
        ...(body.detectedCountryIso2 ? { detectedCountryIso2: body.detectedCountryIso2 } : {})
      }));
    } catch (error) { return expectedError(reply, error); }
  });

  app.post("/v6/registration/:flowId/phone", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:write");
      const params = z.object({ flowId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        countryIso2: z.string().length(2),
        nationalNumber: z.string().min(4).max(30)
      }).parse(request.body);
      return reply.code(202).send(await services.registration.submitPhone({
        flowId: params.flowId, userId: principal.userId, ...body
      }));
    } catch (error) { return expectedError(reply, error); }
  });

  app.post("/v6/registration/:flowId/phone/verify", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:write");
      const params = z.object({ flowId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        phoneIdentityId: z.string().uuid(), challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/)
      }).parse(request.body);
      return await services.registration.verifyPhone({ flowId: params.flowId, userId: principal.userId, ...body });
    } catch (error) { return expectedError(reply, error); }
  });

  app.post("/v6/registration/:flowId/recovery-email", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:write");
      const params = z.object({ flowId: z.string().uuid() }).parse(request.params);
      const body = z.object({ email: z.string().email().max(254) }).parse(request.body);
      return reply.code(202).send(await services.registration.startRecoveryEmail({
        flowId: params.flowId, userId: principal.userId, email: body.email
      }));
    } catch (error) { return expectedError(reply, error); }
  });

  app.post("/v6/registration/:flowId/recovery-email/verify", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:write");
      const params = z.object({ flowId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        identityId: z.string().uuid(), challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/)
      }).parse(request.body);
      return await services.registration.verifyRecoveryEmail({
        flowId: params.flowId, userId: principal.userId, ...body
      });
    } catch (error) { return expectedError(reply, error); }
  });

  app.post("/v6/registration/:flowId/activate", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:write");
      const params = z.object({ flowId: z.string().uuid() }).parse(request.params);
      return reply.code(201).send(await services.registration.activate({
        flowId: params.flowId,
        userId: principal.userId,
        ...(principal.deviceId ? { deviceId: principal.deviceId } : {})
      }));
    } catch (error) { return expectedError(reply, error); }
  });

  app.get("/v6/installations/:installationId/accounts", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      const params = z.object({ installationId: z.string().uuid() }).parse(request.params);
      return { accounts: await services.switcher.list(params.installationId, principal.userId) };
    } catch (error) { return expectedError(reply, error); }
  });

  app.post("/v6/installations/:installationId/switch", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      if (!principal.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });
      const params = z.object({ installationId: z.string().uuid() }).parse(request.params);
      const body = z.object({ targetUserId: z.string().uuid() }).parse(request.body);
      return await services.switcher.switch({
        installationId: params.installationId,
        currentUserId: principal.userId,
        targetUserId: body.targetUserId,
        deviceId: principal.deviceId
      });
    } catch (error) { return expectedError(reply, error); }
  });
}
