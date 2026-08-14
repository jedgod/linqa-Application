import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { AppConfig } from "../config.js";
import type { AiJobService } from "../services/ai-job.service.js";
import type { EntitlementService } from "../services/entitlement.service.js";
import type { Vertical2Service } from "../services/vertical-2.service.js";

export async function registerVertical2Routes(
  app: FastifyInstance,
  config: AppConfig,
  services: { vertical2: Vertical2Service; ai: AiJobService; entitlements: EntitlementService }
) {
  const authenticate = createAuthenticator(config);

  app.post("/v2/contacts/invites", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "contacts:write");
    const body = z.object({ recipientUserId: z.string().uuid() }).parse(request.body);
    return reply.code(201).send(await services.vertical2.inviteContact(principal.userId, body.recipientUserId));
  });

  app.post("/v2/contacts/invites/:inviteId/resolve", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "contacts:write");
    const params = z.object({ inviteId: z.string().uuid() }).parse(request.params);
    const body = z.object({ action: z.enum(["ACCEPT", "DECLINE", "BLOCK"]) }).parse(request.body);
    await services.vertical2.resolveContactInvite(principal.userId, params.inviteId, body.action);
    return reply.code(204).send();
  });

  app.post("/v2/communities", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "communities:write");
    const body = z.object({
      name: z.string().trim().min(2).max(100),
      visibility: z.enum(["PRIVATE", "INVITE", "PUBLIC"])
    }).parse(request.body);
    const visibility = body.visibility === "INVITE" ? "INVITE_ONLY" : body.visibility;
    return reply.code(201).send(await services.vertical2.createCommunity(principal.userId, body.name, visibility));
  });

  app.post("/v2/communities/:communityId/join", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "communities:write");
    const params = z.object({ communityId: z.string().uuid() }).parse(request.params);
    await services.vertical2.joinCommunity(params.communityId, principal.userId);
    return reply.code(204).send();
  });

  app.post("/v2/calendar/events", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "calendar:write");
    const body = z.object({
      titleCiphertextBase64: z.string().min(24),
      descriptionCiphertextBase64: z.string().optional(),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      attendeeUserIds: z.array(z.string().uuid()).max(200).default([])
    }).parse(request.body);
    return reply.code(201).send(await services.vertical2.createCalendarEvent({
      ownerUserId: principal.userId,
      titleCiphertext: Buffer.from(body.titleCiphertextBase64, "base64"),
      ...(body.descriptionCiphertextBase64 ? { descriptionCiphertext: Buffer.from(body.descriptionCiphertextBase64, "base64") } : {}),
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      attendeeUserIds: body.attendeeUserIds
    }));
  });

  app.post("/v2/notes", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "notes:write");
    const body = z.object({
      noteType: z.enum(["NOTE", "CHECKLIST", "DRAWING", "VOICE"]),
      ciphertextBase64: z.string().min(24),
      collaborators: z.array(z.object({ userId: z.string().uuid(), permission: z.enum(["VIEW", "EDIT"]) })).max(100).default([])
    }).parse(request.body);
    return reply.code(201).send(await services.vertical2.createNote({
      ownerUserId: principal.userId,
      noteType: body.noteType,
      ciphertext: Buffer.from(body.ciphertextBase64, "base64"),
      collaborators: body.collaborators
    }));
  });

  app.post("/v2/calls/:callId/screen-share", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "calls:write");
    if (!principal.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });
    const params = z.object({ callId: z.string().uuid() }).parse(request.params);
    const body = z.object({ shareType: z.enum(["SCREEN", "WINDOW", "APPLICATION", "WHITEBOARD"]) }).parse(request.body);
    return reply.code(201).send(await services.vertical2.requestScreenShare({
      callId: params.callId,
      userId: principal.userId,
      deviceId: principal.deviceId,
      shareType: body.shareType
    }));
  });

  app.post("/v2/screen-share/:sessionId/consent", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "calls:write");
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const body = z.object({ consented: z.boolean() }).parse(request.body);
    await services.vertical2.decideScreenShare(params.sessionId, principal.userId, body.consented);
    return reply.code(204).send();
  });

  app.post("/v2/ai/jobs", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "ai:use");
    const body = z.object({
      jobType: z.enum(["SUMMARIZE", "TRANSLATE", "REWRITE", "MEETING_NOTES"]),
      privacyMode: z.enum(["ON_DEVICE", "CONFIDENTIAL_CLOUD", "DISABLED"]),
      inputCiphertextBase64: z.string().optional()
    }).parse(request.body);
    const jobType = { SUMMARIZE: "SUMMARY", TRANSLATE: "TRANSLATION", REWRITE: "MESSAGE_REWRITE", MEETING_NOTES: "MEETING_NOTES" }[body.jobType];
    return reply.code(202).send(await services.ai.create({
      userId: principal.userId,
      jobType,
      privacyMode: body.privacyMode,
      ...(body.inputCiphertextBase64 ? { inputCiphertext: Buffer.from(body.inputCiphertextBase64, "base64") } : {})
    }));
  });

  app.get("/v2/wallet", async (request) => {
    const principal = await authenticate(request);
    requireScope(principal, "wallet:read");
    return { items: await services.vertical2.listWallet(principal.userId) };
  });

  app.post("/v2/wallet", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "wallet:write");
    const body = z.object({
      itemType: z.enum(["CARD", "IDENTITY", "PASS", "LOYALTY", "MEMBERSHIP", "PAYMENT_REFERENCE"]),
      ciphertextBase64: z.string().min(24)
    }).parse(request.body);
    return reply.code(201).send(await services.vertical2.addWalletItem(principal.userId, body.itemType, Buffer.from(body.ciphertextBase64, "base64")));
  });

  app.get("/v2/entitlements", async (request) => {
    const principal = await authenticate(request);
    requireScope(principal, "premium:read");
    return { entitlements: await services.entitlements.list(principal.userId) };
  });

  app.post("/v2/enterprise/organizations", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "enterprise:write");
    const body = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]{2,80}$/) }).parse(request.body);
    return reply.code(201).send(await services.vertical2.createOrganization(principal.userId, body.name, body.slug));
  });

  app.post("/v2/emergency/events", async (request, reply) => {
    const principal = await authenticate(request);
    requireScope(principal, "emergency:write");
    const body = z.object({
      eventType: z.enum(["SOS", "SILENT_ALERT", "LIVE_LOCATION", "EMERGENCY_VIDEO"]),
      encryptedPayloadBase64: z.string().optional()
    }).parse(request.body);
    return reply.code(201).send(await services.vertical2.triggerEmergency({
      userId: principal.userId,
      ...(principal.deviceId ? { deviceId: principal.deviceId } : {}),
      eventType: body.eventType,
      ...(body.encryptedPayloadBase64 ? { encryptedPayload: Buffer.from(body.encryptedPayloadBase64, "base64") } : {})
    }));
  });
}