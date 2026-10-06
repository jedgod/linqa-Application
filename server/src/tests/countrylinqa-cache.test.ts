import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { RedisCache, createDiscoveryCache } from "../services/countrylinqa/engine/redis-cache.js";
import { MemoryCache } from "../services/countrylinqa/final/cache.js";
import { countryLinqaCandidatePoolLimit } from "../services/countrylinqa/candidate-window.js";

/** A minimal RESP server: GET/SET/DEL/AUTH, enough to exercise the client. */
function fakeRedis(opts: { password?: string; silent?: boolean; errorOnGet?: boolean } = {}) {
  const store = new Map<string, string>();
  const commands: string[][] = [];
  const server: Server = createServer((socket: Socket) => {
    let buffer = "";
    let authed = !opts.password;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const parsed = parseCommand(buffer);
        if (!parsed) return;
        buffer = buffer.slice(parsed.length);
        const [name, ...args] = parsed.parts;
        commands.push([name!.toUpperCase(), ...args]);
        if (opts.silent) continue;
        switch (name!.toUpperCase()) {
          case "AUTH": authed = args[args.length - 1] === opts.password; socket.write(authed ? "+OK\r\n" : "-ERR invalid password\r\n"); break;
          case "SET": if (!authed) { socket.write("-NOAUTH\r\n"); break; } store.set(args[0]!, args[1]!); socket.write("+OK\r\n"); break;
          case "GET": {
            if (!authed) { socket.write("-NOAUTH\r\n"); break; }
            if (opts.errorOnGet) { socket.write("-ERR boom\r\n"); break; }
            const value = store.get(args[0]!);
            socket.write(value === undefined ? "$-1\r\n" : `$${Buffer.byteLength(value)}\r\n${value}\r\n`);
            break;
          }
          case "DEL": socket.write(`:${store.delete(args[0]!) ? 1 : 0}\r\n`); break;
          default: socket.write("-ERR unknown\r\n");
        }
      }
    });
  });
  return new Promise<{ url: string; store: Map<string, string>; commands: string[][]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const sockets = new Set<Socket>();
      server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
      resolve({
        url: `redis://${opts.password ? `:${opts.password}@` : ""}127.0.0.1:${port}`, store, commands,
        close: () => new Promise<void>((done) => { sockets.forEach((s) => s.destroy()); server.close(() => done()); })
      });
    });
  });
}

function parseCommand(text: string): { parts: string[]; length: number } | null {
  if (!text.startsWith("*")) return null;
  const lineEnd = text.indexOf("\r\n");
  if (lineEnd === -1) return null;
  const count = Number(text.slice(1, lineEnd));
  let cursor = lineEnd + 2;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const head = text.indexOf("\r\n", cursor);
    if (head === -1) return null;
    const length = Number(text.slice(cursor + 1, head));
    const start = head + 2;
    if (text.length < start + length + 2) return null;
    parts.push(text.slice(start, start + length));
    cursor = start + length + 2;
  }
  return { parts, length: cursor };
}

const open: Array<{ close: () => Promise<void> }> = [];
const caches: RedisCache[] = [];
afterEach(async () => {
  caches.splice(0).forEach((c) => c.close());
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function setup(opts?: Parameters<typeof fakeRedis>[0]) {
  const redis = await fakeRedis(opts);
  open.push(redis);
  const cache = new RedisCache(redis.url);
  caches.push(cache);
  return { redis, cache };
}

describe("shared discovery cache", () => {
  it("round-trips values and expires them with EX", async () => {
    const { redis, cache } = await setup();
    await cache.set("k", { ids: ["a", "b"] }, 45);
    expect(await cache.get("k")).toEqual({ ids: ["a", "b"] });
    expect(redis.commands.find((c) => c[0] === "SET")).toEqual(["SET", "k", JSON.stringify({ ids: ["a", "b"] }), "EX", "45"]);
    await cache.del("k");
    expect(await cache.get("k")).toBeNull();
  });

  it("is shared between two API nodes", async () => {
    const redis = await fakeRedis(); open.push(redis);
    const nodeA = new RedisCache(redis.url); const nodeB = new RedisCache(redis.url); caches.push(nodeA, nodeB);
    await nodeA.set("pool", [1, 2, 3], 30);
    expect(await nodeB.get("pool")).toEqual([1, 2, 3]);
  });

  it("authenticates when the URL carries a password", async () => {
    const { redis, cache } = await setup({ password: "s3cret" });
    await cache.set("k", "v", 10);
    expect(await cache.get("k")).toBe("v");
    expect(redis.commands[0]).toEqual(["AUTH", "s3cret"]);
  });

  it("treats a wrong password, an error reply and malformed JSON as misses, never as hits", async () => {
    const bad = await fakeRedis({ password: "right" }); open.push(bad);
    const wrong = new RedisCache(bad.url.replace("right", "wrong")); caches.push(wrong);
    await wrong.set("k", "v", 10);
    expect(await wrong.get("k")).toBeNull();

    const { redis, cache } = await setup({ errorOnGet: true });
    redis.store.set("k", "{}");
    expect(await cache.get("k")).toBeNull();

    const corrupt = await setup(); corrupt.redis.store.set("k", "{not json");
    expect(await corrupt.cache.get("k")).toBeNull();
  });

  it("falls back to a miss when Redis is unreachable or too slow, without throwing", async () => {
    const dead = new RedisCache("redis://127.0.0.1:1"); caches.push(dead);
    await expect(dead.get("k")).resolves.toBeNull();
    await expect(dead.set("k", "v", 10)).resolves.toBeUndefined();

    const { cache } = await setup({ silent: true });
    const started = Date.now();
    await expect(cache.get("k")).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("uses Redis only when REDIS_URL is set", () => {
    expect(createDiscoveryCache(undefined)).toBeInstanceOf(MemoryCache);
    const cache = createDiscoveryCache("redis://127.0.0.1:6379");
    expect(cache).toBeInstanceOf(RedisCache);
    (cache as RedisCache).close();
    expect(() => new RedisCache("http://x")).toThrow(/redis:\/\//);
  });
});

describe("candidate pool limit", () => {
  it("defaults to 300 and is clamped to [50, 1000]", () => {
    expect(countryLinqaCandidatePoolLimit({})).toBe(300);
    expect(countryLinqaCandidatePoolLimit({ COUNTRYLINQA_CANDIDATE_POOL_LIMIT: "5000" })).toBe(1000);
    expect(countryLinqaCandidatePoolLimit({ COUNTRYLINQA_CANDIDATE_POOL_LIMIT: "5" })).toBe(50);
    expect(countryLinqaCandidatePoolLimit({ COUNTRYLINQA_CANDIDATE_POOL_LIMIT: "700.9" })).toBe(700);
    expect(countryLinqaCandidatePoolLimit({ COUNTRYLINQA_CANDIDATE_POOL_LIMIT: "abc" })).toBe(300);
  });
});
