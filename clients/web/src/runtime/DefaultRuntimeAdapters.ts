import type {
  AuthRuntimeProbe,
  CoreRuntimeProbe,
  RuntimeFlagSource,
  ServerRuntimeProbe
} from "./RuntimeController";
import type { RuntimeMode } from "./types";

export class HttpServerRuntimeProbe implements ServerRuntimeProbe {
  constructor(private readonly baseUrl: string) {}

  async health() {
    try {
      const live = await fetch(`${this.baseUrl}/health/live`, {
        signal: AbortSignal.timeout(2000)
      });
      if (!live.ok) return { reachable: true, ready: false };

      const ready = await fetch(`${this.baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(2000)
      });

      const payload = await ready.json().catch(() => null);
      return {
        reachable: true,
        ready: ready.ok,
        version: typeof payload?.version === "string" ? payload.version : undefined
      };
    } catch {
      return { reachable: false, ready: false };
    }
  }
}

export class BrowserCoreRuntimeProbe implements CoreRuntimeProbe {
  async info() {
    const binding = (globalThis as typeof globalThis & {
      linqaCore?: {
        runtimeInfo(): Promise<{
          secureCoreReady: boolean;
          apiVersion: number;
          protocolVersion: number;
        }>;
      };
    }).linqaCore;

    if (!binding) {
      return { reachable: false, ready: false, secure: false };
    }

    const info = await binding.runtimeInfo();
    return {
      reachable: true,
      ready: info.secureCoreReady,
      secure: info.secureCoreReady,
      apiVersion: String(info.apiVersion),
      protocolVersion: String(info.protocolVersion)
    };
  }
}

export class LocalAuthRuntimeProbe implements AuthRuntimeProbe {
  async current() {
    const raw = sessionStorage.getItem("linqa.auth.runtime");
    if (!raw) return { authenticated: false };

    try {
      const value = JSON.parse(raw);
      return {
        authenticated: value.authenticated === true,
        userId: typeof value.userId === "string" ? value.userId : undefined,
        deviceId: typeof value.deviceId === "string" ? value.deviceId : undefined
      };
    } catch {
      return { authenticated: false };
    }
  }
}

export class EnvironmentRuntimeFlags implements RuntimeFlagSource {
  mode(): RuntimeMode {
    const requested = import.meta.env.VITE_LINQA_RUNTIME_MODE;
    return requested === "LIVE" || requested === "HYBRID" ? requested : "DEMO";
  }

  enabled(featureKey: string): boolean {
    const variable = `VITE_FEATURE_${featureKey.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`;
    const value = import.meta.env[variable];
    return value !== "false";
  }
}
