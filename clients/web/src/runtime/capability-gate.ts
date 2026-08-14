export type ProductionCapabilityState = "NOT_CONFIGURED" | "DEGRADED" | "READY";
export interface ProductionRuntimeSnapshot {
  capabilities: Record<string, { state: ProductionCapabilityState; checkedAt: string; reason?: string }>;
}
export function requireCapability(snapshot: ProductionRuntimeSnapshot, key: string): void {
  const value = snapshot.capabilities[key];
  if (!value || value.state !== "READY") throw new Error(`CAPABILITY_UNAVAILABLE:${key}:${value?.state ?? "MISSING"}`);
}
export function isCapabilityReady(snapshot: ProductionRuntimeSnapshot, key: string): boolean {
  return snapshot.capabilities[key]?.state === "READY";
}

