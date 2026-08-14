import { createConnection } from "node:net";
import { capability, type CapabilityProbe } from "./capabilities.js";

export class RedisProbe implements CapabilityProbe {
  readonly key = "redis";
  constructor(private readonly url?: string) {}
  async probe() {
    if (!this.url) return capability(this.key, "NOT_CONFIGURED", [], { reason: "REDIS_URL is missing" });
    try {
      const target = new URL(this.url);
      const response = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host: target.hostname, port: Number(target.port || 6379) });
        const timer = setTimeout(() => socket.destroy(new Error("Redis health timeout")), 2_000);
        socket.once("error", reject);
        socket.once("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"));
        socket.once("data", (data) => { clearTimeout(timer); socket.end(); resolve(data.toString("utf8")); });
      });
      return response.startsWith("+PONG")
        ? capability(this.key, "READY", [{ name: "redis", state: "READY", identity: `${target.hostname}:${target.port || 6379}` }])
        : capability(this.key, "DEGRADED", [{ name: "redis", state: "DEGRADED", reason: "unexpected PING response" }]);
    } catch (error) {
      return capability(this.key, "DEGRADED", [{ name: "redis", state: "DEGRADED", reason: String(error) }], { reason: String(error) });
    }
  }
}
