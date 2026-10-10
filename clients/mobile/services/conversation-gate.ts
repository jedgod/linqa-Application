import type { NativeSecureCore } from "../src/core/SecureCore";
import type { MobileCapabilitySnapshot } from "./runtime-capabilities.service";
import type { MessagingGateLike, MessagingMode } from "./conversation-types";

/** What the gate asks of the core: that it answers with its version and how its keys are protected. */
export type CoreProbe = Pick<NativeSecureCore, "version" | "protectionLevel">;

/** What the server must report ready before conversations may open (the same list the module gate uses). */
export const REQUIRED_CAPABILITIES = ["secure-core", "message-relay", "key-transparency"] as const;

/**
 * Decides whether this device may open and send encrypted messages.
 *
 *   1. The native secure core must exist and answer (version and protection level).
 *   2. The server must report secure core, message relay and key transparency ready.
 *
 * Anything else, including any error, is LOCKED. There is no state in which a failed check lets messages through.
 * This build has no native secure core registered, so today the answer is LOCKED / SECURE_CORE_UNAVAILABLE.
 */
export function createMessagingGate(deps: {
  core: CoreProbe | null | undefined;
  capabilities: () => Promise<MobileCapabilitySnapshot>;
}): MessagingGateLike {
  return {
    async evaluate(): Promise<MessagingMode> {
      if (!deps.core) return { mode: "LOCKED", reason: "SECURE_CORE_UNAVAILABLE" };
      try {
        await deps.core.version();
        await deps.core.protectionLevel();
      } catch { return { mode: "LOCKED", reason: "PROBE_FAILED" }; }
      let caps: MobileCapabilitySnapshot;
      try { caps = await deps.capabilities(); } catch { return { mode: "LOCKED", reason: "PROBE_FAILED" }; }
      if (!REQUIRED_CAPABILITIES.every((key) => caps?.[key]?.state === "READY")) return { mode: "LOCKED", reason: "NOT_READY" };
      return { mode: "LIVE" };
    }
  };
}
