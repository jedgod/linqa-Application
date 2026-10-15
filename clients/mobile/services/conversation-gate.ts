import type { NativeSecureCore } from "../src/core/SecureCore";
import type { MobileCapabilitySnapshot } from "./runtime-capabilities.service";
import type { MessagingGateLike, MessagingMode } from "./conversation-types";

/** What the gate asks of the core: that it answers with its version and how its keys are protected. */
export type CoreProbe = Pick<NativeSecureCore, "version" | "protectionLevel">;

export type ProtectionProbeResult =
  | { level: "OS_PROTECTED" | "HARDWARE_BACKED"; reason: "ok" }
  | { level: "UNKNOWN"; reason: "SECURE_CORE_UNAVAILABLE" | "KEY_PROTECTION_REQUIRED" | "PROBE_FAILED" };

/** Probe the application's real native/account-store adapter; unknown results fail closed. */
export async function resolveProtectionLevel(core: CoreProbe | null | undefined): Promise<ProtectionProbeResult> {
  if (!core) return { level: "UNKNOWN", reason: "SECURE_CORE_UNAVAILABLE" };
  try {
    await core.version();
    const level = await core.protectionLevel();
    if (level === "OS_PROTECTED" || level === "HARDWARE_BACKED") return { level, reason: "ok" };
    return { level: "UNKNOWN", reason: "KEY_PROTECTION_REQUIRED" };
  } catch {
    return { level: "UNKNOWN", reason: "PROBE_FAILED" };
  }
}

/** Enforce the same key policy for direct encryption/decryption calls as for the screen. */
export async function assertMessagingUnlocked(core: CoreProbe | null | undefined): Promise<void> {
  const result = await resolveProtectionLevel(core);
  if (result.reason !== "ok") {
    const error = new Error("Secure messaging key protection is unavailable") as Error & { code: string };
    error.code = "MESSAGING_KEY_PROTECTION_REQUIRED";
    throw error;
  }
}

/** What the server must report ready before conversations may open (the same list the module gate uses). */
export const REQUIRED_CAPABILITIES = ["secure-core", "message-relay", "key-transparency"] as const;

/**
 * Decides whether this device may open and send encrypted messages.
 *
 *   1. The native secure core must answer and its keys must be OS protected or hardware backed.
 *   2. The server must report secure core, message relay and key transparency ready.
 *
 * Anything else, including any error, is LOCKED. There is no state in which a failed check lets messages through.
 */
export function createMessagingGate(deps: {
  core: CoreProbe | null | undefined;
  capabilities: () => Promise<MobileCapabilitySnapshot>;
}): MessagingGateLike {
  return {
    async evaluate(): Promise<MessagingMode> {
      const protection = await resolveProtectionLevel(deps.core);
      if (protection.reason !== "ok") return { mode: "LOCKED", reason: protection.reason };
      let caps: MobileCapabilitySnapshot;
      try { caps = await deps.capabilities(); } catch { return { mode: "LOCKED", reason: "PROBE_FAILED" }; }
      if (!REQUIRED_CAPABILITIES.every((key) => caps?.[key]?.state === "READY")) return { mode: "LOCKED", reason: "NOT_READY" };
      return { mode: "LIVE" };
    }
  };
}
