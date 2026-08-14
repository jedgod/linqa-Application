import { capability, type CapabilityProbe } from "./capabilities.js";

export class HttpCapabilityProbe implements CapabilityProbe {
  constructor(readonly key: string, private readonly url?: string, private readonly headers: Record<string,string> = {}, private readonly method: "GET"|"HEAD" = "HEAD") {}
  async probe() {
    if (!this.url) return capability(this.key, "NOT_CONFIGURED", [], { reason: `${this.key} endpoint is missing` });
    try {
      const response = await fetch(this.url, { method: this.method, headers: this.headers, signal: AbortSignal.timeout(3_000) });
      return response.ok
        ? capability(this.key, "READY", [{ name: this.url, state: "READY", identity: new URL(this.url).host }])
        : capability(this.key, "DEGRADED", [{ name: this.url, state: "DEGRADED", reason: `HTTP ${response.status}` }], { reason: `provider health returned ${response.status}` });
    } catch (error) {
      return capability(this.key, "DEGRADED", [{ name: this.url, state: "DEGRADED", reason: String(error) }], { reason: String(error) });
    }
  }
}
