export type MobileCapabilitySnapshot = Record<string, { state: "NOT_CONFIGURED" | "DEGRADED" | "READY"; checkedAt: string; reason?: string }>;

export class RuntimeCapabilitiesService {
  constructor(private readonly baseUrl: string) {}
  async snapshot(): Promise<MobileCapabilitySnapshot> {
    const response = await fetch(`${this.baseUrl}/v1/runtime/capabilities`);
    if (!response.ok) throw new Error("RUNTIME_CAPABILITIES_UNAVAILABLE");
    const payload = await response.json();
    return payload.capabilities as MobileCapabilitySnapshot;
  }
}

