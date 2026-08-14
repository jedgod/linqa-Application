import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { DeviceFederationService } from "../services/device-federation.service.js";
import type { KeyTransparencyV2Service } from "../services/key-transparency-v2.service.js";
import type { TurnRegionService } from "../services/turn-region.service.js";
import type { AttachmentCdnService } from "../services/attachment-cdn.service.js";
import type { EnterpriseIdentityV2Service } from "../services/enterprise-identity-v2.service.js";
import type { BillingReconciliationService } from "../services/billing-reconciliation.service.js";
import type { MlsGroupService } from "../services/mls-group.service.js";
import type { PushV2Service } from "../services/push-v2.service.js";
import type { EmergencyEscalationService } from "../services/emergency-escalation.service.js";
import type { CanaryReleaseService } from "../services/canary-release.service.js";
import { verifyOidcIdToken } from "../auth/oidc-verifier.js";
import type { RealtimeHub } from "../realtime/hub.js";

export interface Milestone3Services {
  deviceFederation: DeviceFederationService;
  transparency: KeyTransparencyV2Service;
  turn: TurnRegionService;
  attachments: AttachmentCdnService;
  enterpriseIdentity: EnterpriseIdentityV2Service;
  billingReconciliation: BillingReconciliationService;
  mlsGroups: MlsGroupService;
  pushV2: PushV2Service;
  emergencyEscalation: EmergencyEscalationService;
  canaryReleases: CanaryReleaseService;
}

export async function registerMilestone3Routes(app: FastifyInstance, config: AppConfig, s: Milestone3Services, hub?: RealtimeHub) {
  const auth = createAuthenticator(config);

  app.get("/v3/devices", async (request) => {
    const p = await auth(request);
    requireScope(p, "devices:read");
    return {
      devices: await s.deviceFederation.listTrusted(p.userId)
    };
  });

  app.post("/v3/devices/:deviceId/approve", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "devices:write");

    const params = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    const body = z.object({ coreVerified: z.literal(true) }).parse(request.body);

    if (!p.deviceId) {
      return reply.code(401).send({ error: "device_bound_token_required" });
    }

    await s.deviceFederation.approve({
      userId: p.userId,
      newDeviceId: params.deviceId,
      approvingDeviceId: p.deviceId,
      coreVerified: body.coreVerified
    });

    return reply.code(204).send();
  });

  app.delete("/v3/devices/:deviceId", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "devices:write");
    const params = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    if (params.deviceId === p.deviceId) {
      return reply.code(400).send({ error: "cannot_revoke_current_device" });
    }
    await s.deviceFederation.revoke(p.userId, params.deviceId);
    hub?.disconnectDevice(params.deviceId, 4003, "device revoked");
    return reply.code(204).send();
  });

  app.get("/v3/key-transparency", async (request) => {
    const p = await auth(request);
    requireScope(p, "security:read");
    return {
      devices: await s.transparency.summary(p.userId)
    };
  });

  app.get("/v3/turn/credentials", async (request) => {
    const p = await auth(request);
    requireScope(p, "calls:write");
    return s.turn.issueCredentials(p.userId);
  });

  app.get("/v3/attachments/:deliveryId/download", async (request) => {
    const p = await auth(request);
    requireScope(p, "messages:read");
    const params = z.object({ deliveryId: z.string().uuid() }).parse(request.params);

    return s.attachments.signedDownload({
      requesterUserId: p.userId,
      deliveryId: params.deliveryId
    });
  });

  app.get("/v3/enterprise/:organizationId/connections", async (request) => {
    const p = await auth(request);
    requireScope(p, "enterprise:read");

    const params = z.object({ organizationId: z.string().uuid() }).parse(request.params);

    await s.enterpriseIdentity.requireOrganizationRole({
      organizationId: params.organizationId,
      userId: p.userId,
      allowedRoles: ["OWNER", "ADMIN", "STAFF", "AUDITOR"]
    });

    return {
      connections: await s.enterpriseIdentity.enabledConnections(params.organizationId)
    };
  });

  // Not part of the source pack's route file — real OIDC ID-token
  // verification (see auth/oidc-verifier.ts) exposed as a callable
  // endpoint. This verifies a token the client already obtained from the
  // IdP; it is not a full authorization-code redirect login flow (no
  // state/nonce/callback handling exists here — see oidc-verifier.ts's own
  // comment for why that's intentionally out of scope for this pass).
  app.post("/v3/enterprise/:organizationId/sso/verify", async (request, reply) => {
    const params = z.object({ organizationId: z.string().uuid() }).parse(request.params);
    const body = z.object({ idToken: z.string().min(1) }).parse(request.body);

    const connection = await s.enterpriseIdentity.getOidcConnection(params.organizationId);
    if (!connection) {
      return reply.code(404).send({ error: "no_enabled_oidc_connection" });
    }

    const metadata = (connection.metadata ?? {}) as { clientId?: string };
    if (!metadata.clientId) {
      return reply.code(500).send({ error: "oidc_connection_missing_client_id" });
    }

    try {
      const verified = await verifyOidcIdToken({
        idToken: body.idToken,
        issuer: connection.issuer,
        audience: metadata.clientId
      });
      return reply.code(200).send(verified);
    } catch (error) {
      request.log.warn({ err: error }, "OIDC ID token verification failed");
      return reply.code(401).send({ error: "oidc_verification_failed" });
    }
  });

  app.post("/v3/billing/webhook", async (request, reply) => {
    const signature = String(request.headers["x-billing-signature"] ?? "");

    const rawBody = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}));

    const result = await s.billingReconciliation.process(rawBody, signature);

    return reply.code(200).send(result);
  });

  // Everything below is not part of the source pack's own route file — added
  // 2026-08-07 to give these already-built, tested services a real caller
  // instead of leaving them reachable only from a future admin tool.

  app.post("/v3/groups", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "groups:write");
    if (!p.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });

    const body = z
      .object({
        groupId: z.string().uuid(),
        memberKeyPackagesBase64: z.array(z.string()).min(1)
      })
      .parse(request.body);

    const state = await s.mlsGroups.create({
      groupId: body.groupId,
      creatorDeviceId: p.deviceId,
      memberKeyPackages: body.memberKeyPackagesBase64.map((k) => new Uint8Array(Buffer.from(k, "base64")))
    });

    return reply.code(201).send({
      epoch: state.epoch,
      encryptedStateBase64: Buffer.from(state.encryptedState).toString("base64"),
      stateHashBase64: Buffer.from(state.stateHash).toString("base64")
    });
  });

  app.post("/v3/groups/:groupId/commits", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "groups:write");
    if (!p.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });

    const params = z.object({ groupId: z.string().uuid() }).parse(request.params);
    const body = z.object({ commitCiphertextBase64: z.string().min(1) }).parse(request.body);

    const next = await s.mlsGroups.applyCommit({
      groupId: params.groupId,
      signerDeviceId: p.deviceId,
      commitCiphertext: new Uint8Array(Buffer.from(body.commitCiphertextBase64, "base64"))
    });

    return reply.code(200).send({
      nextEpoch: next.nextEpoch,
      encryptedStateBase64: Buffer.from(next.encryptedState).toString("base64"),
      stateHashBase64: Buffer.from(next.stateHash).toString("base64")
    });
  });

  app.post("/v3/push/wake", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "push:write");

    const body = z
      .object({
        eventType: z.string().min(1).max(60),
        data: z.record(z.string(), z.unknown()).optional()
      })
      .parse(request.body);

    await s.pushV2.sendWake({
      userId: p.userId,
      eventType: body.eventType,
      ...(body.data !== undefined ? { data: body.data } : {})
    });

    return reply.code(202).send({ queued: true });
  });

  app.post("/v3/emergency/events", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "emergency:write");

    const event = await s.emergencyEscalation.trigger({
      ownerUserId: p.userId,
      ...(p.deviceId !== undefined ? { triggeredFromDeviceId: p.deviceId } : {})
    });

    return reply.code(201).send(event);
  });

  app.post("/v3/emergency/process", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.body ?? {});
    const processed = await s.emergencyEscalation.processDue(body.limit);

    return reply.code(200).send({ processed });
  });

  app.post("/v3/canary", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const body = z
      .object({
        releaseVersion: z.string().min(1).max(60),
        environment: z.string().min(1).max(40),
        rolloutPercentage: z.number().int().min(1).max(25),
        errorBudgetThreshold: z.number().min(0).max(1)
      })
      .parse(request.body);

    const canary = await s.canaryReleases.create({
      releaseVersion: body.releaseVersion,
      environment: body.environment,
      createdBy: p.userId,
      rolloutPercentage: body.rolloutPercentage,
      errorBudgetThreshold: body.errorBudgetThreshold
    });

    return reply.code(201).send(canary);
  });

  app.post("/v3/canary/:canaryId/evaluate", async (request, reply) => {
    const p = await auth(request);
    requireScope(p, "developer:write");

    const params = z.object({ canaryId: z.string().uuid() }).parse(request.params);
    const body = z.object({ observedErrorRate: z.number().min(0).max(1) }).parse(request.body);

    const result = await s.canaryReleases.evaluate({
      canaryId: params.canaryId,
      observedErrorRate: body.observedErrorRate,
      approver: p.userId
    });

    return reply.code(200).send(result);
  });
}
