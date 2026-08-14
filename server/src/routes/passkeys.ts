import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/server";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { PasskeyV2Service } from "../services/passkey-v2.service.js";
import { StepUpService, type SensitiveAction, type StepUpVerifier } from "../security/step-up.js";

const SensitiveActionSchema = z.enum([
  "PHONE_CHANGE", "RECOVERY_EMAIL_CHANGE", "ACCOUNT_RECOVERY", "DEVICE_REVOKE",
  "DATA_EXPORT", "ACCOUNT_DELETE", "PASSKEY_REMOVE", "BACKUP_KEY_ROTATE",
  "COUNTRY_OVERRIDE", "LINQASEND_FUNDING_SOURCE_CHANGE"
]);

export async function registerPasskeyRoutes(
  app: FastifyInstance,
  config: AppConfig,
  passkeys: PasskeyV2Service,
  stepUp: StepUpVerifier
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/passkeys/registration/begin", async (request, reply) => {
    try {
      const principal = await authenticate(request);

      const body = z.object({
        displayName: z.string().min(1).max(200)
      }).parse(request.body);

      const options = await passkeys.beginRegistration({
        id: principal.userId,
        displayName: body.displayName
      });

      return reply.code(200).send(options);
    } catch (error) {
      request.log.warn({ err: error }, "passkey registration begin rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/passkeys/registration/finish", async (request, reply) => {
    try {
      const principal = await authenticate(request);

      const body = z.object({
        response: z.record(z.string(), z.unknown()),
        nickname: z.string().min(1).max(100).optional()
      }).parse(request.body);

      const result = await passkeys.finishRegistration({
        userId: principal.userId,
        response: body.response as unknown as RegistrationResponseJSON,
        ...(body.nickname !== undefined ? { nickname: body.nickname } : {})
      });

      return reply.code(201).send(result);
    } catch (error) {
      request.log.warn({ err: error }, "passkey registration finish rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/passkeys/authentication/begin", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      const options = await passkeys.beginAuthentication(principal.userId);
      return reply.code(200).send(options);
    } catch (error) {
      request.log.warn({ err: error }, "passkey authentication begin rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/passkeys/authentication/finish", async (request, reply) => {
    try {
      const principal = await authenticate(request);

      const body = z.object({
        response: z.record(z.string(), z.unknown()),
        stepUpAction: SensitiveActionSchema.optional()
      }).parse(request.body);

      const result = await passkeys.finishAuthentication({
        userId: principal.userId,
        response: body.response as unknown as AuthenticationResponseJSON
      });

      let stepUpToken: string | undefined;
      if (body.stepUpAction) {
        if (!principal.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });
        if (!(stepUp instanceof StepUpService)) return reply.code(503).send({ error: "step_up_not_configured" });
        stepUpToken = stepUp.issue({
          userId: principal.userId,
          deviceId: principal.deviceId,
          action: body.stepUpAction as SensitiveAction,
          authn: "PASSKEY"
        });
      }

      return reply.code(200).send({ ...result, ...(stepUpToken ? { stepUpToken } : {}) });
    } catch (error) {
      request.log.warn({ err: error }, "passkey authentication finish rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
