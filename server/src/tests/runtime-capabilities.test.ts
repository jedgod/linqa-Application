import { describe, expect, it } from "vitest";
import { CapabilityRegistry, capability } from "../runtime/capabilities.js";
import { enforceProductionBoot } from "../runtime/bootstrap-gate.js";
import { DerivedCapabilityProbe } from "../runtime/derived-probe.js";

describe("production capability gates", () => {
  it("reports structured states and refuses a missing production dependency", async () => {
    const registry = new CapabilityRegistry();
    for (const key of ["database", "secure-core", "message-relay", "key-transparency"]) {
      registry.register({ key, probe: async () => capability(key, "READY") });
    }
    registry.register({ key: "delivery", probe: async () => capability("delivery", "NOT_CONFIGURED", [], { reason: "provider missing" }) });
    const snapshot = await registry.snapshot();
    expect(snapshot.delivery?.state).toBe("NOT_CONFIGURED");
    await expect(enforceProductionBoot("production", registry)).rejects.toThrow("delivery");
    await expect(enforceProductionBoot("development", registry)).resolves.toBeUndefined();
  });
});

describe("derived production capabilities", () => {
  it("cannot report secure messaging READY when any injected dependency degrades", async () => {
    const ready = (key:string) => ({ key, probe: async () => capability(key, "READY") });
    const relay = { key:"message-relay", probe: async () => capability("message-relay", "DEGRADED") };
    const result = await new DerivedCapabilityProbe("secure-messaging", [ready("database"),ready("secure-core"),relay]).probe();
    expect(result.state).toBe("DEGRADED");
    expect(result.dependencies.find((dependency) => dependency.name === "message-relay")?.state).toBe("DEGRADED");
  });

  it("reports NOT_CONFIGURED instead of inferring readiness from another dependency", async () => {
    const result = await new DerivedCapabilityProbe("phone-auth", [
      { key:"database", probe: async () => capability("database", "READY") },
      { key:"sms-delivery", probe: async () => capability("sms-delivery", "NOT_CONFIGURED") }
    ]).probe();
    expect(result.state).toBe("NOT_CONFIGURED");
  });
});
