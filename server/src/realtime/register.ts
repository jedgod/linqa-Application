import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { attachChatRealtime } from "../chat/chat-realtime.js";
import { RealtimeHub } from "./hub.js";
import { assertActivePrincipal } from "../auth/active-principal.js";
import { createSocketSessionGuard } from "./session-guard.js";


export async function registerRealtime(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  hub: RealtimeHub
) {
  await app.register(websocket);
  const authenticate = createAuthenticator(config);

  app.get("/v1/realtime", { websocket: true }, async (socket, request) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "messages:read");
      if (!principal.deviceId) {
        socket.close(4001, "device-bound token required");
        return;
      }

      try { await assertActivePrincipal(db, principal); }
      catch {
        socket.close(4003, "inactive device");
        return;
      }
      const guard = createSocketSessionGuard(socket, principal, db);
      const remove = hub.add({
        socket,
        userId: principal.userId,
        deviceId: principal.deviceId,
        authorize: guard.authorize
      });

      // Chat subscriptions, typing and presence ride this same socket.
      const detachChat = attachChatRealtime(
        socket,
        {
          userId: principal.userId,
          deviceId: principal.deviceId,
          expiresAt: principal.expiresAt,
          authorize: guard.authorize
        },
        db,
        hub
      );

      socket.send(JSON.stringify({ type: "ready" }));
      const teardown = () => {
        detachChat();
        guard.dispose();
        remove();
      };
      socket.on("close", teardown);
      socket.on("error", teardown);
    } catch {
      socket.close(4001, "unauthorized");
    }
  });
}
