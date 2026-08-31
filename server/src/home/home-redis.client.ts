import { createConnection, type Socket } from "node:net";
import { connect as createTlsConnection } from "node:tls";

export interface HomeRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number; EX?: number }): Promise<unknown>;
  ping(): Promise<string | null>;
  close(): Promise<void>;
}

type Pending = {
  resolve(value: string | null): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

const CRLF = "\r\n";

function encodeCommand(parts: string[]): Buffer {
  const head = `*${parts.length}${CRLF}`;
  const body = parts
    .map((part) => `$${Buffer.byteLength(part)}${CRLF}${part}${CRLF}`)
    .join("");
  return Buffer.from(head + body, "utf8");
}

/**
 * Result of trying to decode one RESP2 reply from the head of `buffer`.
 * `consumed === 0` means "incomplete, wait for more bytes" — the distinction
 * matters because a cached Home feed is far larger than one TCP segment, so
 * partial reads are the normal case, not the edge case.
 */
type Decoded =
  | { kind: "incomplete" }
  | { kind: "value"; value: string | null; consumed: number }
  | { kind: "error"; message: string; consumed: number };

function decodeReply(buffer: Buffer<ArrayBufferLike>): Decoded {
  if (buffer.length === 0) return { kind: "incomplete" };
  const terminator = buffer.indexOf(CRLF);
  if (terminator === -1) return { kind: "incomplete" };

  const prefix = String.fromCharCode(buffer[0]!);
  const header = buffer.subarray(1, terminator).toString("utf8");

  if (prefix === "+") return { kind: "value", value: header, consumed: terminator + 2 };
  if (prefix === "-") return { kind: "error", message: header, consumed: terminator + 2 };
  if (prefix === ":") return { kind: "value", value: header, consumed: terminator + 2 };

  if (prefix === "$") {
    const length = Number(header);
    if (length === -1) return { kind: "value", value: null, consumed: terminator + 2 };
    if (!Number.isInteger(length) || length < 0) {
      return { kind: "error", message: `malformed bulk length: ${header}`, consumed: terminator + 2 };
    }
    const start = terminator + 2;
    const end = start + length;
    // Length-prefixed, so a payload containing CRLF is handled correctly —
    // the regex-scanning approach this replaced silently truncated those.
    if (buffer.length < end + 2) return { kind: "incomplete" };
    return { kind: "value", value: buffer.subarray(start, end).toString("utf8"), consumed: end + 2 };
  }

  // Home only issues GET/SET/PING, none of which reply with an array. Anything
  // else means the stream is out of sync; surface it rather than guess.
  return { kind: "error", message: `unsupported RESP reply type: ${prefix}`, consumed: terminator + 2 };
}

/**
 * Minimal RESP2 client for Home's cache tier.
 *
 * Deliberately dependency-free (the server has no redis package) and
 * deliberately small: Home needs GET/SET/PING and nothing else. Every failure
 * mode resolves to "no Redis" rather than an exception that would take the
 * feed down, because PostgreSQL holds the authoritative durable copy —
 * `DurableHomeCache` treats Redis purely as an accelerator.
 */
export class SocketHomeRedisClient implements HomeRedisClient {
  private readonly target: URL;
  private readonly commandTimeoutMs: number;
  private socket: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  // Widened past the default `Buffer<ArrayBuffer>` because both
  // Buffer.concat and Buffer.subarray return Buffer<ArrayBufferLike>.
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly pending: Pending[] = [];
  private closed = false;

  constructor(url: string, commandTimeoutMs = 2_000) {
    this.target = new URL(url);
    if (this.target.protocol !== "redis:" && this.target.protocol !== "rediss:") {
      throw new Error("REDIS_URL must use redis:// or rediss://");
    }
    this.commandTimeoutMs = commandTimeoutMs;
  }

  private handshake(): string[][] {
    const commands: string[][] = [];
    if (this.target.password) {
      const password = decodeURIComponent(this.target.password);
      const username = this.target.username ? decodeURIComponent(this.target.username) : "";
      // Redis 6+ takes a username; a URL with only a password is the legacy
      // single-argument form and must not send an empty username.
      commands.push(username ? ["AUTH", username, password] : ["AUTH", password]);
    }
    const database = this.target.pathname.replace(/^\//, "");
    if (database && database !== "0") commands.push(["SELECT", database]);
    return commands;
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<Socket>((resolve, reject) => {
      const options = {
        host: this.target.hostname,
        port: Number(this.target.port || 6379)
      };
      const socket = this.target.protocol === "rediss:"
        ? createTlsConnection({ ...options, servername: this.target.hostname })
        : createConnection(options);

      const onFailure = (error: Error) => {
        this.teardown(error);
        reject(error);
      };

      socket.setNoDelay(true);
      socket.once("error", onFailure);
      socket.once("close", () => this.teardown(new Error("Redis connection closed")));
      socket.on("data", (chunk: Buffer) => this.ingest(chunk));

      const ready = () => {
        socket.removeListener("error", onFailure);
        socket.on("error", (error: Error) => this.teardown(error));
        this.socket = socket;
        for (const command of this.handshake()) {
          // Handshake replies are consumed by queued waiters like any other
          // reply, which keeps the reply/waiter ordering invariant intact.
          this.pending.push({
            resolve: () => undefined,
            reject: () => undefined,
            timer: setTimeout(() => undefined, 0)
          });
          socket.write(encodeCommand(command));
        }
        resolve(socket);
      };

      if (this.target.protocol === "rediss:") socket.once("secureConnect", ready);
      else socket.once("connect", ready);
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private ingest(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const decoded = decodeReply(this.buffer);
      if (decoded.kind === "incomplete") return;
      this.buffer = this.buffer.subarray(decoded.consumed);
      const waiter = this.pending.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      if (decoded.kind === "error") waiter.reject(new Error(decoded.message));
      else waiter.resolve(decoded.value);
    }
  }

  private teardown(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    if (socket && !socket.destroyed) socket.destroy();
    while (this.pending.length) {
      const waiter = this.pending.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private async command(parts: string[]): Promise<string | null> {
    if (this.closed) throw new Error("Redis client is closed");
    const socket = await this.connect();
    return new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed-out command leaves the reply stream misaligned, so drop the
        // connection instead of serving the next caller someone else's reply.
        this.teardown(new Error("Redis command timeout"));
      }, this.commandTimeoutMs);
      timer.unref?.();
      this.pending.push({ resolve, reject, timer });
      socket.write(encodeCommand(parts), (error) => {
        if (error) this.teardown(error);
      });
    });
  }

  get(key: string): Promise<string | null> {
    return this.command(["GET", key]);
  }

  set(key: string, value: string, options?: { PX?: number; EX?: number }): Promise<string | null> {
    const parts = ["SET", key, value];
    if (options?.PX !== undefined) parts.push("PX", String(Math.max(1, Math.round(options.PX))));
    else if (options?.EX !== undefined) parts.push("EX", String(Math.max(1, Math.round(options.EX))));
    return this.command(parts);
  }

  ping(): Promise<string | null> {
    return this.command(["PING"]);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.teardown(new Error("Redis client closed"));
  }
}
