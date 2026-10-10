import { z } from "zod";
import type { CallBackend } from "../services/call-backend.service.js";

export function registerCallRoutes(
  app: { post: Function; get: Function },
  deps: {
    calls: CallBackend;
    authenticate: (request: any) => Promise<{ userId: string }>;
  },
) {
  app.post("/v2/calls", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({
      id: z.string().min(8),
      peerUserId: z.string().min(1),
      callType: z.enum(["AUDIO", "VIDEO"]),
      privacyMode: z.enum(["STANDARD", "RELAY_ONLY"]),
    }).parse(request.body);
    return deps.calls.create({ ...body, callerId: actor.userId });
  });

  app.post("/v2/calls/:id/state", async (request: any) => {
    const actor = await deps.authenticate(request);
    const body = z.object({
      state: z.enum(["ACCEPTED", "ACTIVE", "REJECTED", "ENDED", "FAILED"]),
    }).parse(request.body);
    return deps.calls.transition(request.params.id, actor.userId, body.state);
  });

  app.get("/v2/calls/:id", async (request: any) => {
    const actor = await deps.authenticate(request);
    return deps.calls.get(request.params.id, actor.userId);
  });
}
