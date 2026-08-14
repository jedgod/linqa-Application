import type { CapabilityRegistry } from "./capabilities.js";
export const PRODUCTION_BOOT_REQUIRED = [
  "database", "secure-core", "delivery", "device-enrollment",
  "key-package-verification", "message-relay", "key-transparency", "secure-messaging"
] as const;
export async function enforceProductionBoot(env: string, registry: CapabilityRegistry): Promise<void> {
  if (env !== "production") return;
  await registry.requireReady([...PRODUCTION_BOOT_REQUIRED]);
}
