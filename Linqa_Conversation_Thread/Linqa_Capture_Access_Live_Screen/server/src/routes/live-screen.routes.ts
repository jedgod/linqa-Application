import { z } from "zod";
import type { LiveScreenService } from "../services/live-screen.service.js";

export function registerLiveScreenRoutes(
  app: { post: Function },
  deps: {
    screens: LiveScreenService;
    authenticate: (request: any) => Promise<{ userId: string; deviceId: string }>;
  },
) {
  app.post("/v2/chats/:id/screen-shares", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({ id: z.string().min(8), offerEnvelopeBase64: z.string().min(16) }).parse(request.body);
    return deps.screens.offer({
      id: body.id,
      conversationId: request.params.id,
      userId: actor.userId,
      deviceId: actor.deviceId,
      offerEnvelope: Buffer.from(body.offerEnvelopeBase64, "base64url"),
    });
  });

  app.post("/v2/screen-shares/:id/answer", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({
      accept: z.boolean(),
      answerEnvelopeBase64: z.string().optional(),
    }).parse(request.body);
    return deps.screens.answer({
      id: request.params.id,
      userId: actor.userId,
      accept: body.accept,
      answerEnvelope: body.answerEnvelopeBase64
        ? Buffer.from(body.answerEnvelopeBase64, "base64url")
        : undefined,
    });
  });

  app.post("/v2/screen-shares/:id/stop", async (request: any) => {
    const actor = await deps.authenticate(request);
    return deps.screens.stop(request.params.id, actor.userId);
  });
}
