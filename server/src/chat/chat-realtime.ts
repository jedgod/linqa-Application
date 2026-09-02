import type { WebSocket } from "ws";
import { z } from "zod";
import type { Database } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { filterMemberConversations } from "./chat.service.js";

/**
 * Chat realtime: subscriptions, typing and presence, layered onto the existing
 * `/v1/realtime` socket rather than a second gateway.
 *
 * Everything here is ephemeral. Durable events reach the client through the
 * outbox relay and are replayable from `/v1/chats/:id/events`; typing and
 * presence deliberately have no persistence, because a "typing" flag that
 * outlives its socket is a lie about what someone is doing right now.
 */

const ClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), conversationIds: z.array(z.string().uuid()).max(100) }).strict(),
  z.object({ type: z.literal("typing.start"), conversationId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("typing.stop"), conversationId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("presence.heartbeat") }).strict()
]);

/** Matches the pack's 16 KB websocket frame ceiling. */
const MAX_FRAME_BYTES = 16 * 1024;
/** Total conversations one socket may watch, across every subscribe call. */
const MAX_SUBSCRIPTIONS = 300;
const TYPING_WINDOW_MS = 10_000;
const TYPING_MAX_PER_WINDOW = 20;
const SUBSCRIBE_WINDOW_MS = 10_000;
const SUBSCRIBE_MAX_PER_WINDOW = 10;
const TYPING_TTL_SECONDS = 5;

interface Bucket {
  count: number;
  resetAt: number;
}

function allow(bucket: Bucket, windowMs: number, max: number): boolean {
  const now = Date.now();
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

export interface ChatRealtimePrincipal {
  userId: string;
  deviceId: string;
  /** Unix seconds from the access token, or undefined if it carried none. */
  expiresAt: number | undefined;
}

/**
 * Attaches chat handling to one authenticated socket.
 *
 * Returns a teardown function; the caller invokes it on close.
 */
export function attachChatRealtime(
  socket: WebSocket,
  principal: ChatRealtimePrincipal,
  db: Database,
  hub: RealtimeHub
): () => void {
  const subscriptions = new Set<string>();
  const typingBucket: Bucket = { count: 0, resetAt: 0 };
  const subscribeBucket: Bucket = { count: 0, resetAt: 0 };

  /**
   * A socket must not outlive the token that opened it.
   *
   * The pack authenticates once at connect and never looks again, so a
   * fifteen-minute access token can keep streaming a user's messages for as
   * long as the process runs -- revoking the session changes nothing. Closing
   * at `exp` forces a reconnect, which re-authenticates.
   */
  let expiryTimer: NodeJS.Timeout | undefined;
  if (principal.expiresAt) {
    const msRemaining = principal.expiresAt * 1000 - Date.now();
    // setTimeout overflows past 2^31-1 ms and would fire immediately.
    expiryTimer = setTimeout(
      () => socket.close(4401, "token expired"),
      Math.max(1_000, Math.min(msRemaining, 2_147_483_000))
    );
    expiryTimer.unref?.();
  }

  const reject = (code: string) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "error", code }));
    }
  };

  const fanOutEphemeral = async (topic: string, conversationId: string) => {
    const members = await db.query(
      `SELECT user_id AS "userId" FROM conversation_members
        WHERE conversation_id = $1 AND removed_at IS NULL AND user_id <> $2`,
      [conversationId, principal.userId]
    );
    const envelope = {
      type: topic,
      conversationId,
      userId: principal.userId,
      // Consumers expire the indicator themselves, so a dropped "stop" frame
      // cannot leave someone typing forever.
      expiresInSeconds: TYPING_TTL_SECONDS,
      occurredAt: new Date().toISOString()
    };
    for (const row of members.rows as Array<{ userId: string }>) {
      hub.sendToUser(row.userId, envelope);
    }
  };

  const onMessage = async (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const size = Array.isArray(raw)
      ? raw.reduce((total, part) => total + part.byteLength, 0)
      : (raw as Buffer).byteLength;
    if (size > MAX_FRAME_BYTES) {
      socket.close(4400, "frame too large");
      return;
    }

    const text = raw.toString();
    // The pre-existing liveness probe.
    if (text === "ping") {
      socket.send("pong");
      return;
    }

    let event: z.infer<typeof ClientEvent>;
    try {
      event = ClientEvent.parse(JSON.parse(text));
    } catch {
      reject("INVALID_EVENT");
      return;
    }

    try {
      if (event.type === "subscribe") {
        // Rate limited, unlike the pack: each call runs a membership query, so
        // an unlimited subscribe loop is a free database amplifier.
        if (!allow(subscribeBucket, SUBSCRIBE_WINDOW_MS, SUBSCRIBE_MAX_PER_WINDOW)) {
          reject("RATE_LIMITED");
          return;
        }
        const allowed = await filterMemberConversations(db, principal.userId, event.conversationIds);
        for (const id of allowed) {
          // Capped in total, not just per call, so repeated subscribes cannot
          // grow one socket's set without bound.
          if (subscriptions.size >= MAX_SUBSCRIPTIONS) break;
          subscriptions.add(id);
        }
        // Only the ids that survived the membership filter are acknowledged,
        // so a client learns nothing about conversations it is not in.
        socket.send(JSON.stringify({ type: "subscribed", conversationIds: [...subscriptions] }));
        return;
      }

      if (event.type === "presence.heartbeat") {
        await db.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1 AND user_id = $2`, [
          principal.deviceId,
          principal.userId
        ]);
        socket.send(JSON.stringify({ type: "presence.ack" }));
        return;
      }

      if (!allow(typingBucket, TYPING_WINDOW_MS, TYPING_MAX_PER_WINDOW)) {
        reject("RATE_LIMITED");
        return;
      }
      // Membership is re-checked per event rather than trusted from the
      // subscription set: a member removed mid-session must stop being able to
      // announce themselves into the conversation.
      const allowed = await filterMemberConversations(db, principal.userId, [event.conversationId]);
      if (allowed.length !== 1) {
        reject("EVENT_REJECTED");
        return;
      }
      await fanOutEphemeral(event.type, event.conversationId);
    } catch {
      reject("EVENT_REJECTED");
    }
  };

  const listener = (raw: Buffer | ArrayBuffer | Buffer[]) => {
    void onMessage(raw);
  };
  socket.on("message", listener);

  return () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    socket.off("message", listener);
    subscriptions.clear();
  };
}

export const __testing = { ClientEvent, MAX_FRAME_BYTES, MAX_SUBSCRIPTIONS, allow };
