import type { Provider } from "../providers/provider-registry.js";
import { capability, type CapabilityProbe } from "./capabilities.js";
export class ProviderCapabilityProbe implements CapabilityProbe {
  constructor(public readonly key: string, private readonly provider?: Provider) {}
  async probe() {
    if (!this.provider) return capability(this.key, "NOT_CONFIGURED", [], { reason: "provider missing" });
    try {
      const health = await this.provider.health();
      const dependency = {
        name: this.provider.kind,
        state: health.state,
        identity: health.identity,
        ...(health.reason ? { reason: health.reason } : {})
      };
      return capability(this.key, health.state, [dependency], {
        provider: this.provider.id,
        version: this.provider.version,
        ...(health.reason ? { reason: health.reason } : {})
      });
    } catch (error) {
      return capability(this.key, "DEGRADED", [{ name: this.provider.kind, state: "DEGRADED", identity: this.provider.id, reason: String(error) }], { reason: String(error) });
    }
  }
}
