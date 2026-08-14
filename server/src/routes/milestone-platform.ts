import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator,requireScope } from "../auth/jwt.js";
import type { MilestoneService } from "../services/milestone.service.js";
import type { CollaborationService } from "../services/collaboration.service.js";
import type { AiJobService } from "../services/ai-job.service.js";
import type { EnterprisePolicyService } from "../services/enterprise-policy.service.js";
import type { OrganizationAuthorizationService } from "../services/organization-authorization.service.js";

export async function registerMilestonePlatformRoutes(
  app:FastifyInstance,
  config:AppConfig,
  services:{
    milestones:MilestoneService;
    collaboration:CollaborationService;
    ai:AiJobService;
    enterprise:EnterprisePolicyService;
    orgAuthorization:OrganizationAuthorizationService;
  }
) {
  const authenticate=createAuthenticator(config);

  app.get("/v1/milestones/features/:key",async(request,reply)=>{
    try {
      const principal=await authenticate(request);
      const params=z.object({key:z.string().min(2)}).parse(request.params);
      const query=z.object({clientVersion:z.string().optional()}).parse(request.query);
      return {
        enabled:await services.milestones.enabled(
          params.key,principal.userId,query.clientVersion
        )
      };
    } catch (error) {
      request.log.warn({ err: error }, "milestone feature lookup rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/collaboration/rooms",async(request,reply)=>{
    try {
      const principal=await authenticate(request);
      requireScope(principal,"collaboration:write");
      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body=z.object({
        titleCiphertextBase64:z.string().min(24),
        roomType:z.enum(["MEETING","WHITEBOARD","TASK_ROOM","EVENT","COMMUNITY_STAGE"]),
        expiresAt:z.string().datetime().optional()
      }).parse(request.body);

      const room=await services.collaboration.createRoom({
        ownerUserId:principal.userId,
        ownerDeviceId:principal.deviceId,
        titleCiphertext:Buffer.from(body.titleCiphertextBase64,"base64"),
        roomType:body.roomType,
        ...(body.expiresAt!==undefined?{expiresAt:new Date(body.expiresAt)}:{})
      });
      return reply.code(201).send(room);
    } catch (error) {
      request.log.warn({ err: error }, "collaboration room creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/collaboration/rooms/:roomId/participants",async(request,reply)=>{
    try {
      const principal=await authenticate(request);
      requireScope(principal,"collaboration:write");

      const params=z.object({roomId:z.string().uuid()}).parse(request.params);
      const body=z.object({
        userId:z.string().uuid(),
        deviceId:z.string().uuid()
      }).parse(request.body);

      await services.collaboration.invite({
        roomId:params.roomId,
        inviterUserId:principal.userId,
        inviteeUserId:body.userId,
        inviteeDeviceId:body.deviceId
      });
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "collaboration room invite rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.delete(
    "/v1/collaboration/rooms/:roomId/participants/:deviceId",
    async(request,reply)=>{
      try {
        const principal=await authenticate(request);
        requireScope(principal,"collaboration:write");

        const params=z.object({
          roomId:z.string().uuid(),
          deviceId:z.string().uuid()
        }).parse(request.params);

        await services.collaboration.removeParticipant({
          roomId:params.roomId,
          removedByUserId:principal.userId,
          deviceId:params.deviceId
        });
        return reply.code(204).send();
      } catch (error) {
        request.log.warn({ err: error }, "collaboration room removal rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );

  app.post("/v1/collaboration/rooms/:roomId/events",async(request,reply)=>{
    try {
      const principal=await authenticate(request);
      requireScope(principal,"collaboration:write");
      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params=z.object({roomId:z.string().uuid()}).parse(request.params);
      const body=z.object({
        eventType:z.enum([
          "WHITEBOARD_DELTA","NOTE_DELTA","TASK_CREATE","TASK_UPDATE",
          "TASK_COMPLETE","POLL_CREATE","POLL_VOTE",
          "SCREEN_SHARE_START","SCREEN_SHARE_STOP"
        ]),
        ciphertextBase64:z.string().min(24),
        logicalClock:z.number().int().nonnegative()
      }).parse(request.body);

      const result=await services.collaboration.append({
        roomId:params.roomId,
        actorDeviceId:principal.deviceId,
        eventType:body.eventType,
        ciphertext:Buffer.from(body.ciphertextBase64,"base64"),
        logicalClock:body.logicalClock
      });
      return reply.code(result.accepted?201:200).send(result);
    } catch (error) {
      request.log.warn({ err: error }, "collaboration event rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/collaboration/rooms/:roomId/events",async(request,reply)=>{
    try {
      const principal=await authenticate(request);
      requireScope(principal,"collaboration:read");
      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const params=z.object({roomId:z.string().uuid()}).parse(request.params);
      const query=z.object({
        afterClock:z.coerce.number().int().nonnegative().default(0),
        limit:z.coerce.number().int().min(1).max(500).optional()
      }).parse(request.query);

      const events=await services.collaboration.pull({
        roomId:params.roomId,
        requesterDeviceId:principal.deviceId,
        afterClock:query.afterClock,
        ...(query.limit!==undefined?{limit:query.limit}:{})
      });
      return reply.code(200).send({ events });
    } catch (error) {
      request.log.warn({ err: error }, "collaboration event listing rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/ai/jobs",async(request,reply)=>{
    try {
      const principal=await authenticate(request);
      requireScope(principal,"ai:use");
      const body=z.object({
        conversationId:z.string().uuid().optional(),
        jobType:z.enum([
          "SUMMARY","TRANSLATION","ACTION_ITEMS","LIVE_CAPTIONS",
          "MEETING_NOTES","MESSAGE_REWRITE"
        ]),
        privacyMode:z.enum(["ON_DEVICE","CONFIDENTIAL_CLOUD","DISABLED"]),
        inputCiphertextBase64:z.string().optional()
      }).parse(request.body);

      const result=await services.ai.create({
        userId:principal.userId,
        jobType:body.jobType,
        privacyMode:body.privacyMode,
        ...(body.conversationId!==undefined?{conversationId:body.conversationId}:{}),
        ...(body.inputCiphertextBase64!==undefined
          ?{inputCiphertext:Buffer.from(body.inputCiphertextBase64,"base64")}
          :{})
      });
      return reply.code(202).send(result);
    } catch (error) {
      request.log.warn({ err: error }, "ai job creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.put(
    "/v1/organizations/:organizationId/policies/:policyKey",
    async(request,reply)=>{
      try {
        const principal=await authenticate(request);
        requireScope(principal,"enterprise:policy:write");
        const params=z.object({
          organizationId:z.string().uuid(),
          policyKey:z.string().min(2)
        }).parse(request.params);
        const body=z.object({value:z.unknown()}).parse(request.body);

        try {
          await services.orgAuthorization.requireScope({
            organizationId:params.organizationId,
            subject:principal.subject,
            requiredScope:"enterprise:policy:write"
          });
        } catch (authorizationError) {
          request.log.warn(
            { err: authorizationError, organizationId: params.organizationId },
            "enterprise policy update denied by organization authorization"
          );
          return reply.code(403).send({ error: "organization_forbidden" });
        }

        await services.enterprise.set({
          organizationId:params.organizationId,
          key:params.policyKey,
          value:body.value
        });
        return reply.code(204).send();
      } catch (error) {
        request.log.warn({ err: error }, "enterprise policy update rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );
}
