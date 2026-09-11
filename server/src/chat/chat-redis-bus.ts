import { createConnection, type Socket } from "node:net";
import { connect as createTlsConnection } from "node:tls";

/**
 * Cross-process fan-out for chat realtime.
 *
 * `RealtimeHub` only reaches sockets attached to *this* process, so with more
 * than one API node a message published on node A never reaches a subscriber
 * connected to node B. This bus closes that gap: every node publishes the
 * events it commits and subscribes to the events every other node commits.
 *
 * It is deliberately an optimization, not the record. The durable event is the
 * `chat_outbox` row, and a client that misses a frame replays from
 * `/v1/chats/:id/events`. So when Redis is absent or unreachable the bus
 * degrades to a no-op and the product keeps working with in-process fan-out
 * plus replay -- it does not fail closed and take chat down with it.
 *
 * Two connections, because Redis puts a subscriber connection into push mode
 * where ordinary commands are not allowed.
 */

const CRLF = "\r\n";
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export const CHAT_CHANNEL = "linqa:chat:events";

function encodeCommand(parts: string[]): Buffer {
  let out = `*${parts.length}${CRLF}`;
  for (const part of parts) {
    out += `$${Buffer.byteLength(part)}${CRLF}${part}${CRLF}`;
  }
  return Buffer.from(out, "utf8");
}

type Decoded =
  | { kind: "incomplete" }
  | { kind: "value"; value: RespValue; consumed: number };

type RespValue = string | number | null | RespValue[];

/**
 * Minimal RESP2 reader.
 *
 * Only the shapes this bus can receive: simple strings, errors, integers, bulk
 * strings and arrays (a subscribe push is a three-element array).
 */
function decode(buffer: Buffer, offset = 0): Decoded {
  if (buffer.length - offset < 1) return { kind: "incomplete" };
  const marker = buffer[offset];
  const lineEnd = buffer.indexOf(CRLF, offset);
  if (lineEnd === -1) return { kind: "incomplete" };
  const head = buffer.toString("utf8", offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  // '+' simple, '-' error, ':' integer
  if (marker === 0x2b || marker === 0x2d) {
    return { kind: "value", value: head, consumed: afterLine - offset };
  }
  if (marker === 0x3a) {
    return { kind: "value", value: Number(head), consumed: afterLine - offset };
  }
  // '$' bulk string
  if (marker === 0x24) {
    const length = Number(head);
    if (length === -1) return { kind: "value", value: null, consumed: afterLine - offset };
    if (buffer.length < afterLine + length + 2) return { kind: "incomplete" };
    return {
      kind: "value",
      value: buffer.toString("utf8", afterLine, afterLine + length),
      consumed: afterLine + length + 2 - offset
    };
  }
  // '*' array
  if (marker === 0x2a) {
    const count = Number(head);
    if (count === -1) return { kind: "value", value: null, consumed: afterLine - offset };
    const items: RespValue[] = [];
    let cursor = afterLine;
    for (let index = 0; index < count; index += 1) {
      const element = decode(buffer, cursor);
      if (element.kind === "incomplete") return { kind: "incomplete" };
      items.push(element.value);
      cursor += element.consumed;
    }
    return { kind: "value", value: items, consumed: cursor - offset };
  }
  // Unknown marker: drop the line rather than stalling the stream forever.
  return { kind: "value", value: null, consumed: afterLine - offset };
}

export interface ChatBus {
  publish(payload: unknown): void;
  subscribe(handler: (payload: unknown) => void): void;
  close(): Promise<void>;
}

/** Used when REDIS_URL is not configured: single-node fan-out plus replay. */
export class InProcessChatBus implements ChatBus {
  private handler: ((payload: unknown) => void) | null = null;
  publish(): void {
    // Nothing to do: the caller already delivered to its own hub, and there
    // are no other nodes to tell.
  }
  subscribe(handler: (payload: unknown) => void): void {
    this.handler = handler;
  }
  async close(): Promise<void> {
    this.handler = null;
  }
}

export class RedisChatBus implements ChatBus {
  private readonly target: URL;
  private publisher: Socket | null = null;
  private subscriber: Socket | null = null;
  private handler: ((payload: unknown) => void) | null = null;
  private inbound: Buffer = Buffer.alloc(0);
  private reconnectAttempt = 0;
  private closed = false;

  constructor(
    url: string,
    private readonly onError: (error: Error) => void = () => undefined
  ) {
    this.target = new URL(url);
    if (this.target.protocol !== "redis:" && this.target.protocol !== "rediss:") {
      throw new Error("REDIS_URL must use redis:// or rediss://");
    }
  }

  private open(onReady: (socket: Socket) => void): Socket {
    const options = { host: this.target.hostname, port: Number(this.target.port || 6379) };
    const socket =
      this.target.protocol === "rediss:"
        ? createTlsConnection({ ...options, servername: this.target.hostname })
        : createConnection(options);
    socket.setNoDelay(true);

    const ready = () => {
      if (this.target.password) {
        const password = decodeURIComponent(this.target.password);
        const username = this.target.username ? decodeURIComponent(this.target.username) : "";
        socket.write(encodeCommand(username ? ["AUTH", username, password] : ["AUTH", password]));
      }
      onReady(socket);
    };
    if (this.target.protocol === "rediss:") socket.once("secureConnect", ready);
    else socket.once("connect", ready);
    return socket;
  }

  publish(payload: unknown): void {
    if (this.closed) return;
    try {
      if (!this.publisher || this.publisher.destroyed) {
        this.publisher = this.open(() => undefined);
        this.publisher.on("error", (error: Error) => {
          this.publisher?.destroy();
          this.publisher = null;
          this.onError(error);
        });
        // Replies to PUBLISH are not read; nothing depends on the subscriber
        // count, and draining keeps the socket buffer from growing.
        this.publisher.on("data", () => undefined);
      }
      this.publisher.write(encodeCommand(["PUBLISH", CHAT_CHANNEL, JSON.stringify(payload)]));
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error("redis publish failed"));
    }
  }

  subscribe(handler: (payload: unknown) => void): void {
    this.handler = handler;
    this.connectSubscriber();
  }

  private connectSubscriber(): void {
    if (this.closed) return;
    this.inbound = Buffer.alloc(0);
    const socket = this.open((connected) => {
      this.reconnectAttempt = 0;
      connected.write(encodeCommand(["SUBSCRIBE", CHAT_CHANNEL]));
    });
    this.subscriber = socket;

    socket.on("data", (chunk: Buffer) => this.ingest(chunk));
    let reconnectScheduled = false;
    const retry = (error?: Error) => {
      if (error) this.onError(error);
      if (this.closed || reconnectScheduled) return;
      reconnectScheduled = true;
      socket.destroy();
      if (this.subscriber === socket) this.subscriber = null;
      // Exponential backoff with a ceiling, so a Redis outage does not become
      // a reconnect storm the moment it recovers.
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
      this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 10);
      const timer = setTimeout(() => this.connectSubscriber(), delay);
      timer.unref?.();
    };
    socket.on("error", retry);
    socket.on("close", () => retry());
  }

  private ingest(chunk: Buffer): void {
    this.inbound = this.inbound.length === 0 ? chunk : Buffer.concat([this.inbound, chunk]);
    for (;;) {
      const decoded = decode(this.inbound);
      if (decoded.kind === "incomplete") return;
      this.inbound = this.inbound.subarray(decoded.consumed);

      const frame = decoded.value;
      if (!Array.isArray(frame) || frame[0] !== "message" || typeof frame[2] !== "string") continue;
      try {
        this.handler?.(JSON.parse(frame[2]));
      } catch {
        // A malformed frame from the bus must not kill the subscriber; the
        // durable outbox still has the event.
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.publisher?.destroy();
    this.subscriber?.destroy();
    this.publisher = null;
    this.subscriber = null;
    this.handler = null;
  }
}

export function createChatBus(redisUrl: string | undefined, onError?: (error: Error) => void): ChatBus {
  if (!redisUrl) return new InProcessChatBus();
  try {
    return new RedisChatBus(redisUrl, onError);
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error("redis bus unavailable"));
    return new InProcessChatBus();
  }
}

export const __testing = { decode, encodeCommand };
