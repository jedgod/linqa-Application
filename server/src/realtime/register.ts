import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { decodeJwt } from "jose";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import { attachChatRealtime } from "../chat/chat-realtime.js";
import { RealtimeHub } from "./hub.js";

/**
 * Reads `exp` from an already-verified bearer token.
 *
 * `createAuthenticator` verifies the signature and claims but does not return
 * the expiry, and the chat gateway needs it to close the socket when the token
 * dies. Decoding here is safe precisely because verification already happened.
 */
function tokenExpiry(header: string | undefined): number | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  try {
    const exp = decodeJwt(header.slice("Bearer ".length)).exp;
    return typeof exp === "number" ? exp : undefined;
  } catch {
    return undefined;
  }
}

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
      if (!principal.deviceId) {
        socket.close(4001, "device-bound token required");
        return;
      }

      const result = await db.query(
        `SELECT 1 FROM devices
         WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
        [principal.deviceId, principal.userId]
      );
      if (result.rowCount !== 1) {
        socket.close(4003, "inactive device");
        return;
      }

      const remove = hub.add({
        socket,
        userId: principal.userId,
        deviceId: principal.deviceId
      });

      // Chat subscriptions, typing and presence ride this same socket.
      const detachChat = attachChatRealtime(
        socket,
        {
          userId: principal.userId,
          deviceId: principal.deviceId,
          expiresAt: tokenExpiry(request.headers.authorization)
        },
        db,
        hub
      );

      socket.send(JSON.stringify({ type: "ready" }));
      const teardown = () => {
        detachChat();
        remove();
      };
      socket.on("close", teardown);
      socket.on("error", teardown);
    } catch {
      socket.close(4001, "unauthorized");
    }
  });
}
