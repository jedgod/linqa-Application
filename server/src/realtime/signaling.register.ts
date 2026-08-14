import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { SignalingService } from "../services/signaling.service.js";
import { RealtimeHub } from "./hub.js";

const EVENT_TYPES = new Set([
  "OFFER",
  "ANSWER",
  "ICE_CANDIDATE",
  "ICE_COMPLETE",
  "CALL_ACCEPTED",
  "CALL_REJECTED",
  "CALL_ENDED",
  "RESUME"
]);

/**
 * Authenticated call-signaling WebSocket, matching the shipped
 * `AuthenticatedSignalingClient` on the web client. Depends on
 * `@fastify/websocket` already being registered — call `registerRealtime`
 * (which registers it) before this.
 */
export async function registerSignaling(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  signaling: SignalingService,
  hub: RealtimeHub
) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/calls/signaling", { websocket: true }, async (socket, request) => {
    try {
      const principal = await authenticate(request);
      if (!principal.deviceId) {
        socket.close(4001, "device-bound token required");
        return;
      }

      const callId = new URL(request.url, "http://localhost").searchParams.get("callId");
      if (!callId) {
        socket.close(4400, "callId is required");
        return;
      }

      const participant = await db.query(
        `SELECT 1 FROM call_participants WHERE call_id = $1 AND device_id = $2`,
        [callId, principal.deviceId]
      );
      if (participant.rowCount !== 1) {
        socket.close(4003, "not a call participant");
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
        void (async () => {
          const text = raw.toString();
          if (text === "ping") {
            socket.send("pong");
            return;
          }

          try {
            const message = JSON.parse(text);
            if (
              message.callId !== callId ||
              typeof message.recipientDeviceId !== "string" ||
              typeof message.sequence !== "number" ||
              !EVENT_TYPES.has(message.eventType) ||
              typeof message.ciphertextBase64 !== "string"
            ) {
              return;
            }

            const ciphertext = Buffer.from(message.ciphertextBase64, "base64");
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

            const stored = await signaling.append({
              callId,
              senderDeviceId: principal.deviceId!,
              recipientDeviceId: message.recipientDeviceId,
              sequence: message.sequence,
              eventType: message.eventType,
              ciphertext,
              expiresAt
            });

            hub.sendToDevice(message.recipientDeviceId, {
              type: "signaling.event",
              callId,
              senderDeviceId: principal.deviceId,
              sequence: message.sequence,
              eventType: message.eventType,
              ciphertextBase64: ciphertext.toString("base64"),
              createdAt: stored.created_at
            });
          } catch {
            // Malformed or unauthorized signaling events are silently dropped —
            // never acknowledged, never forwarded.
          }
        })();
      });
    } catch {
      socket.close(4001, "unauthorized");
    }
  });
}
