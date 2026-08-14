import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { EnrollmentV2Service } from "../services/enrollment-v2.service.js";

export async function registerEnrollmentV2Routes(
  app: FastifyInstance,
  config: AppConfig,
  enrollmentV2: EnrollmentV2Service
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/devices/enrollment/v2/challenges", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      if (!principal.deviceId) {
        return reply.code(400).send({ error: "session_not_device_bound" });
      }

      const body = z.object({
        requestedDeviceId: z.string().uuid()
      }).parse(request.body);

      const challenge = await enrollmentV2.createChallenge({
        userId: principal.userId,
        approvingDeviceId: principal.deviceId,
        requestedDeviceId: body.requestedDeviceId
      });

      return reply.code(201).send(challenge);
    } catch (error) {
      request.log.warn({ err: error }, "enrollment v2 challenge creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post(
    "/v1/devices/enrollment/v2/challenges/:challengeId/approve",
    async (request, reply) => {
      try {
        await authenticate(request);
        z.object({ challengeId: z.string().uuid() }).parse(request.params);

        // Approving a linked device requires the same canonical Ed25519
        // verification from linqa-core as /v1/device-enrollment/complete.
        // That verifier is not wired into this server, so this fails closed
        // rather than accepting an unverified approval.
        return reply.code(503).send({
          error: "proof_verifier_unavailable",
          message: "Device was not approved."
        });
      } catch (error) {
        request.log.warn({ err: error }, "enrollment v2 approval rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );
}
