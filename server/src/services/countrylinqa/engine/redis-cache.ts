import { createConnection, type Socket } from "node:net";
import { connect as createTlsConnection } from "node:tls";
import { decode, encodeCommand } from "../../../chat/chat-redis-bus.js";
import type { Cache } from "../final/cache.js";
import { MemoryCache } from "../final/cache.js";

const COMMAND_TIMEOUT_MS = 300;
const CONNECT_TIMEOUT_MS = 1_000;
const RETRY_AFTER_MS = 2_000;

type Pending = { resolve: (value: unknown) => void; timer: NodeJS.Timeout; error: boolean };

/**
 * A Redis-backed Cache shared by every API node, using the repo's own RESP
 * codec (no new dependency).
 *
 * It is an optimization only. Every failure (unreachable, slow, error reply,
 * malformed value) is a cache MISS, so discovery then runs uncached against
 * PostgreSQL. It never grants authorization: cached pools are re-checked
 * against live blocks, restrictions and policy before any page is returned
 * (see people.ts), and keys embed the policy version.
 *
 * Commands are pipelined over one connection and answered in order. A command
 * that is not answered within 300 ms resolves as a miss so a slow Redis cannot
 * slow discovery down.
 */
export class RedisCache implements Cache {
  private readonly target: URL;
  private socket: Socket | null = null;
  private ready = false;
  private connecting = false;
  private retryAt = 0;
  private inbound: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private backlog: Buffer[] = [];

  constructor(url: string, private readonly onError: (error: Error) => void = () => undefined) {
    this.target = new URL(url);
    if (this.target.protocol !== "redis:" && this.target.protocol !== "rediss:") {
      throw new Error("REDIS_URL must use redis:// or rediss://");
    }
  }

  private connect(): void {
    if (this.connecting || this.ready || Date.now() < this.retryAt) return;
    this.connecting = true;
    const options = { host: this.target.hostname, port: Number(this.target.port || 6379) };
    const socket = this.target.protocol === "rediss:"
      ? createTlsConnection({ ...options, servername: this.target.hostname })
      : createConnection(options);
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error("redis connect timeout")));
    socket.on(this.target.protocol === "rediss:" ? "secureConnect" : "connect", () => {
      socket.setTimeout(0);
      this.connecting = false;
      this.ready = true;
      const password = decodeURIComponent(this.target.password);
      if (password) {
        const user = decodeURIComponent(this.target.username);
        // AUTH is written first and answered first, ahead of any queued command.
        this.queue.unshift({ resolve: () => undefined, timer: setTimeout(() => undefined, 0), error: false });
        socket.write(encodeCommand(user ? ["AUTH", user, password] : ["AUTH", password]));
      }
      for (const chunk of this.backlog.splice(0)) socket.write(chunk);
    });
    socket.on("data", (chunk) => this.ingest(chunk));
    socket.on("error", (error) => this.onError(error));
    socket.on("close", () => this.drop());
  }

  private drop(): void {
    this.ready = false;
    this.connecting = false;
    this.retryAt = Date.now() + RETRY_AFTER_MS;
    this.socket?.destroy();
    this.socket = null;
    this.inbound = Buffer.alloc(0);
    this.backlog = [];
    for (const pending of this.queue.splice(0)) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
  }

  private ingest(chunk: Buffer): void {
    this.inbound = Buffer.concat([this.inbound, chunk]);
    for (;;) {
      const isError = this.inbound[0] === 0x2d;
      const decoded = decode(this.inbound);
      if (decoded.kind === "incomplete") return;
      this.inbound = this.inbound.subarray(decoded.consumed);
      const pending = this.queue.shift();
      if (!pending) continue;
      clearTimeout(pending.timer);
      pending.resolve(isError ? null : decoded.value);
    }
  }

  private command(parts: string[]): Promise<unknown> {
    this.connect();
    if (!this.ready && !this.connecting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // The reply may still arrive; keep its slot so later replies stay aligned.
        pending.resolve = () => undefined;
        resolve(null);
      }, COMMAND_TIMEOUT_MS);
      timer.unref?.();
      const pending: Pending = { resolve, timer, error: false };
      this.queue.push(pending);
      const bytes = encodeCommand(parts);
      if (this.ready && this.socket) this.socket.write(bytes);
      else this.backlog.push(bytes);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.command(["GET", key]);
    if (typeof raw !== "string") return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.command(["SET", key, JSON.stringify(value), "EX", String(Math.max(1, Math.trunc(ttlSeconds)))]);
  }

  async del(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }

  close(): void {
    this.drop();
    this.retryAt = Infinity;
  }
}

/** Redis when REDIS_URL is set, otherwise the in-process cache. */
export function createDiscoveryCache(redisUrl: string | undefined, onError?: (error: Error) => void): Cache {
  return redisUrl ? new RedisCache(redisUrl, onError) : new MemoryCache();
}
