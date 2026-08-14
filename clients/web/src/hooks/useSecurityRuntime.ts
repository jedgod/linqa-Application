import { useEffect, useMemo, useState } from "react";
import {
  createCoreAdapter,
  type CoreAdapter,
  type SecurityRuntimeState,
} from "../services/CoreBridge";

export function useSecurityRuntime() {
  const adapter = useMemo<CoreAdapter>(() => createCoreAdapter(), []);
  const [state, setState] = useState<SecurityRuntimeState>({
    kind: "loading",
    encrypted: false,
  });

  useEffect(() => {
    let active = true;
    adapter
      .runtimeState()
      .then((next) => active && setState(next))
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : "Unknown core error";
        if (active) setState({ kind: "failed", encrypted: false, reason });
      });
    return () => {
      active = false;
    };
  }, [adapter]);

  return {
    adapter,
    state,
    sendingAllowed: state.kind === "ready" || state.kind === "demo",
    encrypted: state.kind === "ready",
  };
}
