import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { requireScope } from "../auth/jwt.js";
import { createActiveAuthenticator } from "../auth/active-principal.js";
import { createSocketSessionGuard } from "./session-guard.js";
import { z } from "zod";
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
  const authenticate = createActiveAuthenticator(config, db);
  const frameSchema = z.object({ callId: z.string().uuid(), recipientDeviceId: z.string().uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    eventType: z.string().refine(value => EVENT_TYPES.has(value)), ciphertextBase64: z.string().base64().min(24).max(87_384) }).strict();

  app.get("/v1/calls/signaling", { websocket: true }, async (socket, request) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");
      if (!principal.deviceId) {
        socket.close(4001, "device-bound token required");
        return;
      }

      const callId = new URL(request.url, "http://localhost").searchParams.get("callId");
      if (!callId || !z.string().uuid().safeParse(callId).success) {
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

      const guard = createSocketSessionGuard(socket, principal, db);
      const remove = hub.add({
        socket,
        userId: principal.userId,
        deviceId: principal.deviceId,
        authorize: guard.authorize
      });

      socket.send(JSON.stringify({ type: "ready" }));
      socket.on("close", remove);
      socket.on("error", remove);

      let windowStart = Date.now(), count = 0, pending = 0;
      socket.on("message", (raw) => {
        if (raw.toString().length > 90_000) { socket.close(1009, "frame too large"); return; }
        if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); count = 0; }
        if (++count > 600 || pending >= 32) { socket.close(1008, "rate limited"); return; }
        pending += 1;
        void (async () => {
          try {
          if (!await guard.authorize()) return;
          const text = raw.toString();
          if (text === "ping") {
            socket.send("pong");
            return;
          }

          try {
            const message = frameSchema.parse(JSON.parse(text));
            if (message.callId !== callId) return;

            const ciphertext = Buffer.from(message.ciphertextBase64, "base64");
            if (ciphertext.length < 16 || ciphertext.length > 65_536) return;
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

            const stored = await signaling.append({
              callId,
              senderDeviceId: principal.deviceId!,
              recipientDeviceId: message.recipientDeviceId,
              sequence: message.sequence,
              eventType: message.eventType as Parameters<SignalingService["append"]>[0]["eventType"],
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
          } finally { pending -= 1; }
        })();
      });
    } catch {
      socket.close(4001, "unauthorized");
    }
  });
}
