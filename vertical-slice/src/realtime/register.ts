import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import { DeviceRepository } from "../repositories/device.repository.js";
import type { RealtimeHub } from "./hub.js";

export async function registerRealtime(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  hub: RealtimeHub
) {
  await app.register(websocket);
  const authenticate = createAuthenticator(config);
  const devices = new DeviceRepository(db);

  app.get("/v1/realtime", { websocket: true }, async (socket, request) => {
    try {
      const principal = await authenticate(request);
      const device = await devices.findActive(principal.deviceId, principal.userId);

      if (!device) {
        socket.close(4003, "inactive device");
        return;
      }

      const remove = hub.add({
        socket,
        userId: principal.userId,
        deviceId: principal.deviceId
      });

      socket.send(JSON.stringify({ type: "ready" }));

      socket.on("message", (raw) => {
        if (raw.toString() === "ping") socket.send("pong");
      });

      socket.on("close", remove);
      socket.on("error", remove);
    } catch {
      socket.close(4001, "unauthorized");
    }
  });
}
