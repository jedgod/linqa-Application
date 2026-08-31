import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SocketHomeRedisClient } from "../../home/home-redis.client.js";

/**
 * Exercises the hand-rolled RESP2 client against a real socket. The point is
 * the framing: Home caches whole rendered feeds, so replies routinely span
 * multiple TCP segments and can contain CRLF inside the payload. A regex-based
 * reader passes a single-segment smoke test and then silently truncates in
 * production, which is why these cases are here.
 */

type FakeRedis = {
  server: Server;
  url: string;
  received: string[];
  close(): Promise<void>;
};

async function startFakeRedis(
  respond: (command: string[], write: (chunk: string | Buffer) => void) => void
): Promise<FakeRedis> {
  const received: string[] = [];

  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // Minimal inline RESP array parser, enough to read the commands the
      // client sends.
      for (;;) {
        const match = /^\*(\d+)\r\n/.exec(buffer);
        if (!match) return;
        const argc = Number(match[1]);
        let cursor = match[0].length;
        const parts: string[] = [];
        for (let index = 0; index < argc; index += 1) {
          const header = /^\$(\d+)\r\n/.exec(buffer.slice(cursor));
          if (!header) return;
          const length = Number(header[1]);
          const start = cursor + header[0].length;
          if (buffer.length < start + length + 2) return;
          parts.push(buffer.slice(start, start + length));
          cursor = start + length + 2;
        }
        buffer = buffer.slice(cursor);
        received.push(parts.join(" "));
        respond(parts, (data) => socket.write(data));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind fake redis");

  return {
    server,
    url: `redis://127.0.0.1:${address.port}`,
    received,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

let active: FakeRedis | null = null;
let client: SocketHomeRedisClient | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
  await active?.close();
  active = null;
});

describe("home Redis client: URL handling", () => {
  it("rejects a non-Redis scheme rather than silently misbehaving", () => {
    expect(() => new SocketHomeRedisClient("http://localhost:6379")).toThrow(/redis:/);
  });

  it("accepts redis:// and rediss://", () => {
    expect(() => new SocketHomeRedisClient("redis://127.0.0.1:6379")).not.toThrow();
    expect(() => new SocketHomeRedisClient("rediss://cache.example:6380")).not.toThrow();
  });
});

describe("home Redis client: RESP framing", () => {
  it("round-trips SET and GET", async () => {
    const store = new Map<string, string>();
    active = await startFakeRedis((command, write) => {
      const verb = command[0]?.toUpperCase();
      if (verb === "SET") {
        store.set(command[1]!, command[2]!);
        write("+OK\r\n");
      } else if (verb === "GET") {
        const value = store.get(command[1]!);
        if (value === undefined) write("$-1\r\n");
        else write(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
      } else {
        write("+PONG\r\n");
      }
    });

    client = new SocketHomeRedisClient(active.url);

    await expect(client.set("linqa:home:k", "{\"a\":1}", { PX: 1_000 })).resolves.toBe("OK");
    await expect(client.get("linqa:home:k")).resolves.toBe("{\"a\":1}");
    expect(active.received.some((line) => line.startsWith("SET linqa:home:k"))).toBe(true);
    expect(active.received.some((line) => line.includes("PX 1000"))).toBe(true);
  });

  it("returns null for a missing key", async () => {
    active = await startFakeRedis((_command, write) => write("$-1\r\n"));
    client = new SocketHomeRedisClient(active.url);
    await expect(client.get("linqa:home:missing")).resolves.toBeNull();
  });

  it("reassembles a bulk reply split across several segments", async () => {
    const payload = JSON.stringify({ articles: Array.from({ length: 400 }, (_u, i) => ({ id: i })) });
    active = await startFakeRedis((_command, write) => {
      const framed = Buffer.from(`$${Buffer.byteLength(payload)}\r\n${payload}\r\n`, "utf8");
      // Deliver in small chunks so the client must buffer across reads.
      for (let offset = 0; offset < framed.length; offset += 500) {
        write(framed.subarray(offset, offset + 500));
      }
    });

    client = new SocketHomeRedisClient(active.url);
    await expect(client.get("linqa:home:big")).resolves.toBe(payload);
  });

  it("preserves a payload that itself contains CRLF", async () => {
    const payload = "line one\r\nline two\r\n";
    active = await startFakeRedis((_command, write) =>
      write(`$${Buffer.byteLength(payload)}\r\n${payload}\r\n`)
    );

    client = new SocketHomeRedisClient(active.url);
    await expect(client.get("linqa:home:crlf")).resolves.toBe(payload);
  });

  it("handles multi-byte UTF-8 payloads by byte length, not character count", async () => {
    const payload = JSON.stringify({ title: "Réunion de la Banque centrale — 日本語" });
    active = await startFakeRedis((_command, write) =>
      write(`$${Buffer.byteLength(payload)}\r\n${payload}\r\n`)
    );

    client = new SocketHomeRedisClient(active.url);
    await expect(client.get("linqa:home:utf8")).resolves.toBe(payload);
  });

  it("surfaces a server error reply as a rejection", async () => {
    active = await startFakeRedis((_command, write) => write("-ERR unknown command\r\n"));
    client = new SocketHomeRedisClient(active.url);
    await expect(client.get("linqa:home:k")).rejects.toThrow("ERR unknown command");
  });

  it("keeps sequential commands aligned with their replies", async () => {
    active = await startFakeRedis((command, write) => {
      const key = command[1] ?? "";
      const value = `value-for-${key}`;
      write(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
    });

    client = new SocketHomeRedisClient(active.url);
    const results = await Promise.all([client.get("a"), client.get("b"), client.get("c")]);
    expect(results).toEqual(["value-for-a", "value-for-b", "value-for-c"]);
  });

  it("answers PING for the health probe", async () => {
    active = await startFakeRedis((_command, write) => write("+PONG\r\n"));
    client = new SocketHomeRedisClient(active.url);
    await expect(client.ping()).resolves.toBe("PONG");
  });

  it("rejects rather than hangs when the server never replies", async () => {
    active = await startFakeRedis(() => undefined);
    client = new SocketHomeRedisClient(active.url, 150);
    await expect(client.get("linqa:home:k")).rejects.toThrow(/timeout/i);
  });

  it("rejects once closed", async () => {
    active = await startFakeRedis((_command, write) => write("+PONG\r\n"));
    client = new SocketHomeRedisClient(active.url);
    await client.ping();
    await client.close();
    await expect(client.ping()).rejects.toThrow(/closed/i);
  });

  it("sends the single-argument AUTH form when the URL has only a password", async () => {
    active = await startFakeRedis((_command, write) => write("+OK\r\n"));
    const url = new URL(active.url);
    url.password = "s3cret";
    client = new SocketHomeRedisClient(url.toString());

    await client.ping();

    const auth = active.received.find((line) => line.startsWith("AUTH"));
    expect(auth).toBe("AUTH s3cret");
  });

  it("sends the two-argument AUTH form when the URL has a username", async () => {
    active = await startFakeRedis((_command, write) => write("+OK\r\n"));
    const url = new URL(active.url);
    url.username = "linqa";
    url.password = "s3cret";
    client = new SocketHomeRedisClient(url.toString());

    await client.ping();

    expect(active.received.find((line) => line.startsWith("AUTH"))).toBe("AUTH linqa s3cret");
  });
});
