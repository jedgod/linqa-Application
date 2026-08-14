export type CapabilityState = "NOT_CONFIGURED" | "DEGRADED" | "READY";
export interface DependencyHealth { name: string; state: CapabilityState; identity?: string; reason?: string; }
export interface CapabilityHealth {
  key: string; state: CapabilityState; provider?: string; version?: string;
  dependencies: DependencyHealth[]; checkedAt: string; lastReadyAt?: string; reason?: string;
}
export interface CapabilityProbe { readonly key: string; probe(): Promise<CapabilityHealth>; }

export class CapabilityRegistry {
  private readonly probes = new Map<string, CapabilityProbe>();
  private readonly lastReady = new Map<string, string>();
  register(probe: CapabilityProbe): this {
    if (this.probes.has(probe.key)) throw new Error(`Duplicate capability probe: ${probe.key}`);
    this.probes.set(probe.key, probe);
    return this;
  }
  async snapshot(): Promise<Record<string, CapabilityHealth>> {
    const entries = await Promise.all([...this.probes.values()].map(async (probe) => {
      const result = await probe.probe();
      if (result.state === "READY") {
        const now = new Date().toISOString(); this.lastReady.set(probe.key, now); result.lastReadyAt = now;
      } else {
        const previous = this.lastReady.get(probe.key);
        if (previous) result.lastReadyAt = previous;
      }
      return [probe.key, result] as const;
    }));
    return Object.fromEntries(entries);
  }
  async requireReady(keys: string[]): Promise<void> {
    const snapshot = await this.snapshot();
    const failures = keys.filter((key) => snapshot[key]?.state !== "READY");
    if (failures.length) throw new Error(`Required capabilities not READY: ${failures.join(", ")}`);
  }
}

export const capability = (key: string, state: CapabilityState, dependencies: DependencyHealth[] = [], extra: Partial<CapabilityHealth> = {}): CapabilityHealth => ({
  key, state, dependencies, checkedAt: new Date().toISOString(), ...extra
});
