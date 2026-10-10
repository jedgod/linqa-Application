import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { AuthPrincipal } from "../auth/types.js";
import type { AppConfig } from "../config.js";
import { purposes, type BiometricPrincipal } from "../security/biometrics/canonical.js";
import type { BiometricAuthorizationService } from "../security/biometrics/service.js";

export function biometricPrincipal(p: AuthPrincipal,request: FastifyRequest): BiometricPrincipal {
  const uuid = z.string().uuid();
  const installationId = request.headers["x-installation-id"];
  if (!uuid.safeParse(p.userId).success || !uuid.safeParse(p.deviceId).success || !uuid.safeParse(p.sessionId).success || !uuid.safeParse(installationId).success) throw new Error("BIOMETRIC_AUTHENTICATED_DEVICE_REQUIRED");
  return { userId: p.userId,deviceId: p.deviceId!,sessionId: p.sessionId!,installationId: installationId as string };
}
export async function registerBiometricRoutes(app: FastifyInstance,config: AppConfig,bio: BiometricAuthorizationService) {
  const auth = createAuthenticator(config);
  const wrap = (work: (p: BiometricPrincipal,req: FastifyRequest,reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest,reply: FastifyReply) => {
    try {
      const p = await auth(request);
      if (!p.scopes.has("vault:read") && !p.scopes.has("linqasend:write")) throw new Error("BIOMETRIC_SCOPE_REQUIRED");
      return await work(biometricPrincipal(p,request),request,reply);
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(422).send({ error: "validation_error" });
      request.log.warn({ err: error },"biometric request rejected");
      return reply.code(403).send({ error: error instanceof Error && error.message.startsWith("BIOMETRIC_") ? error.message : "BIOMETRIC_REQUEST_DENIED" });
    }
  };
  const rate = { config: { rateLimit: { max: 10,timeWindow: "1 minute" } } };
  app.get("/v1/security/biometrics/status",wrap(p => bio.status(p)));
  app.post("/v1/security/biometrics/enroll/challenge",rate,wrap(p => bio.enrollmentChallenge(p)));
  app.post("/v1/security/biometrics/enroll",rate,wrap((p,req) => {
    const input = z.object({ enrollmentId: z.string().uuid(),nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),platform: z.enum(["IOS","ANDROID"]),keyAlias: z.string().regex(/^linqa\.bio\.[A-Za-z0-9.-]{1,100}$/),publicKeySpkiBase64: z.string().base64().max(400),signatureBase64: z.string().base64().max(120),attestation: z.unknown() }).strict().parse(req.body);
    return bio.enroll(p,input);
  }));
  app.post("/v1/security/biometrics/challenges",rate,wrap(async (p,req) => {
    const input = z.object({ purpose: z.enum(purposes),paymentChallengeId: z.string().uuid().optional(),itemId: z.string().uuid().optional() }).strict().parse(req.body);
    const authPrincipal = await auth(req); requireScope(authPrincipal,input.purpose.startsWith("VAULT_") ? "vault:read" : "linqasend:write");
    if (input.purpose === "SEND_TRANSFER_AUTHORIZE" && !input.paymentChallengeId) throw new Error("BIOMETRIC_PAYMENT_REFERENCE_REQUIRED");
    if (input.purpose === "VAULT_PRIVATE_OPEN" && !input.itemId) throw new Error("BIOMETRIC_VAULT_REFERENCE_REQUIRED");
    return bio.challenge(p,input.purpose,{ ...(input.paymentChallengeId ? { paymentChallengeId: input.paymentChallengeId } : {}), ...(input.itemId ? { itemId: input.itemId } : {}) });
  }));
  app.post("/v1/security/biometrics/verify",rate,wrap((p,req) => bio.verify(p,z.object({ challengeId: z.string().uuid(),challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),signatureBase64: z.string().base64().max(120) }).strict().parse(req.body))));
  app.delete("/v1/security/biometrics/credentials",rate,wrap(async p => { await bio.revoke(p); return { revoked: true }; }));
  app.delete("/v1/security/biometrics/credentials/:credentialId",rate,wrap(async (p,req) => { await bio.revoke(p,z.object({ credentialId: z.string().uuid() }).parse(req.params).credentialId); return { revoked: true }; }));
  app.post("/v1/vault/private/unlock",rate,wrap(async (p,req) => {
    requireScope(await auth(req),"vault:read");
    return bio.unlockVault(p,z.object({ grantId: z.string().uuid() }).strict().parse(req.body).grantId);
  }));
  app.post("/v1/vault/private/lock",wrap(async (p,req) => {
    const input = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(req.body);
    await bio.lockVault(p,input.token); return { locked: true };
  }));
}
