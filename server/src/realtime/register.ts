import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import { RealtimeHub } from "./hub.js";

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

      socket.send(JSON.stringify({ type: "ready" }));
      socket.on("close", remove);
      socket.on("error", remove);
      socket.on("message", (raw) => {
        if (raw.toString() === "ping") socket.send("pong");
      });
    } catch {
      socket.close(4001, "unauthorized");
    }
  });
}
