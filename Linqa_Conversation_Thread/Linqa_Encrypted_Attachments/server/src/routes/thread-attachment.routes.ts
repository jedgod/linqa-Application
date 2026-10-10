import { z } from "zod";
import type { ThreadAttachmentService } from "../services/thread-attachment.service.js";

const kind = z.enum(["VIDEO", "VOICE", "DOCUMENT", "DESIGN", "AI_IMAGE", "LOCATION", "EVENT", "MEETING"]);

export function registerThreadAttachmentRoutes(
  app: { post: Function; get: Function },
  deps: {
    attachments: ThreadAttachmentService;
    authenticate: (request: any) => Promise<{ userId: string; deviceId: string }>;
  },
) {
  app.post("/v2/chats/:id/attachments", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({
      id: z.string().min(8),
      kind,
      vaultId: z.string().optional(),
      envelopeBase64: z.string().min(16),
    }).parse(request.body);
    return deps.attachments.accept({
      id: body.id,
      conversationId: request.params.id,
      userId: actor.userId,
      deviceId: actor.deviceId,
      kind: body.kind,
      vaultId: body.vaultId,
      envelope: Buffer.from(body.envelopeBase64, "base64url"),
    });
  });

  app.get("/v2/chats/:id/attachments", async (request: any) => {
    const actor = await deps.authenticate(request);
    const rows = await deps.attachments.list(actor.userId, request.params.id);
    return {
      attachments: rows.map((row: any) => ({
        id: row.id,
        kind: row.kind,
        vaultId: row.vault_id,
        envelopeBase64: Buffer.from(row.envelope).toString("base64url"),
        createdAt: row.created_at,
        senderUserId: row.sender_user_id,
      })),
    };
  });

  app.post("/v2/chats/:id/location-requests", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({ id: z.string().min(8), peerUserId: z.string() }).parse(request.body);
    return deps.attachments.requestLocation({
      id: body.id,
      conversationId: request.params.id,
      userId: actor.userId,
      peerUserId: body.peerUserId,
    });
  });

  app.post("/v2/location-shares/:id/answer", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({
      accept: z.boolean(),
      envelopeBase64: z.string().optional(),
      expiresAt: z.string().datetime().optional(),
    }).parse(request.body);
    return deps.attachments.answerLocation({
      id: request.params.id,
      userId: actor.userId,
      accept: body.accept,
      envelope: body.envelopeBase64 ? Buffer.from(body.envelopeBase64, "base64url") : undefined,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  });

  app.post("/v2/location-shares/:id/stop", async (request: any) => {
    const actor = await deps.authenticate(request);
    return deps.attachments.stopLocation(request.params.id, actor.userId);
  });
}
