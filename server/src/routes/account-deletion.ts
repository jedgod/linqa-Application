import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { AccountDeletionService } from "../services/account-deletion.service.js";
import type { StepUpVerifier } from "../security/step-up.js";

export async function registerAccountDeletionRoutes(
  app: FastifyInstance,
  config: AppConfig,
  deletion: AccountDeletionService,
  stepUp: StepUpVerifier
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/account/deletion", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:delete");

      const body = z.object({
        delayDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
        stepUpToken: z.string().min(40)
      }).parse(request.body);

      if (!principal.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });
      await stepUp.verifyAndConsume(body.stepUpToken, {
        userId: principal.userId,
        deviceId: principal.deviceId,
        action: "ACCOUNT_DELETE"
      });

      const result = await deletion.schedule({
        userId: principal.userId,
        delayDays: body.delayDays
      });

      return reply.code(202).send({
        status: "PENDING_DELETION",
        executeAt: result.executeAt
      });
    } catch (error) {
      request.log.warn({ err: error }, "account deletion request rejected");
      if (error instanceof Error && error.message.startsWith("STEP_UP_")) {
        return reply.code(401).send({ error: error.message, action: "ACCOUNT_DELETE" });
      }
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/account/deletion/cancel", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "account:delete");
      await deletion.cancel(principal.userId);
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "account deletion cancellation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
