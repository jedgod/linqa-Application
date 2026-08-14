import { capability, type CapabilityProbe, type CapabilityState } from "./capabilities.js";

export class DerivedCapabilityProbe implements CapabilityProbe {
  constructor(readonly key: string, private readonly dependencies: CapabilityProbe[]) {}
  async probe() {
    const results = await Promise.all(this.dependencies.map((dependency) => dependency.probe()));
    let state: CapabilityState = "READY";
    for (const result of results) {
      if (result.state === "NOT_CONFIGURED") { state = "NOT_CONFIGURED"; break; }
      if (result.state === "DEGRADED") state = "DEGRADED";
    }
    return capability(this.key, state, results.map((result) => ({
      name: result.key,
      state: result.state,
      ...(result.provider ? { identity: result.provider } : {}),
      ...(result.reason ? { reason: result.reason } : {})
    })), state === "READY" ? {} : { reason: "one or more required dependencies are unavailable" });
  }
}
