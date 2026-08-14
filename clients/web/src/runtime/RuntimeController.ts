import { LINQA_FEATURES } from "./features";
import type {
  CapabilityState,
  RuntimeFeatureDefinition,
  RuntimeMode,
  RuntimeSnapshot
} from "./types";

export interface ServerRuntimeProbe {
  health(): Promise<{ reachable: boolean; ready: boolean; version?: string }>;
}

export interface CoreRuntimeProbe {
  info(): Promise<{
    reachable: boolean;
    ready: boolean;
    secure: boolean;
    apiVersion?: string;
    protocolVersion?: string;
  }>;
}

export interface AuthRuntimeProbe {
  current(): Promise<{
    authenticated: boolean;
    userId?: string;
    deviceId?: string;
  }>;
}

export interface RuntimeFlagSource {
  mode(): RuntimeMode;
  enabled(featureKey: string): boolean;
}

export class RuntimeController {
  constructor(
    private readonly server: ServerRuntimeProbe,
    private readonly core: CoreRuntimeProbe,
    private readonly auth: AuthRuntimeProbe,
    private readonly flags: RuntimeFlagSource
  ) {}

  async inspect(): Promise<RuntimeSnapshot> {
    const mode = this.flags.mode();
    const warnings: string[] = [];

    const [serverResult, coreResult, authResult] = await Promise.all([
      this.safeServerProbe(),
      this.safeCoreProbe(),
      this.safeAuthProbe()
    ]);

    if (mode === "LIVE" && !serverResult.ready) {
      warnings.push("Live mode requested, but the Linqa server is not ready.");
    }
    if (mode === "LIVE" && !coreResult.ready) {
      warnings.push("Live mode requested, but the secure core is not ready.");
    }
    if (mode !== "DEMO" && !authResult.authenticated) {
      warnings.push("Authenticated features remain unavailable until sign-in succeeds.");
    }

    const capabilities: Record<string, CapabilityState> = {};
    for (const feature of LINQA_FEATURES) {
      capabilities[feature.key] = this.resolveCapability(
        feature,
        mode,
        serverResult,
        coreResult,
        authResult.authenticated
      );
    }

    return {
      mode,
      authenticated: authResult.authenticated,
      userId: authResult.userId,
      deviceId: authResult.deviceId,
      serverReachable: serverResult.reachable,
      coreReachable: coreResult.reachable,
      capabilities,
      warnings,
      updatedAt: new Date().toISOString()
    };
  }

  private resolveCapability(
    feature: RuntimeFeatureDefinition,
    mode: RuntimeMode,
    server: { reachable: boolean; ready: boolean; version?: string },
    core: { reachable: boolean; ready: boolean; secure: boolean; apiVersion?: string },
    authenticated: boolean
  ): CapabilityState {
    const base = {
      key: feature.key,
      stage: feature.stage,
      checkedAt: new Date().toISOString()
    } as const;

    if (!this.flags.enabled(feature.key)) {
      return {
        ...base,
        status: "DISABLED",
        secure: false,
        enabled: false,
        reason: "Disabled by feature configuration."
      };
    }

    if (mode === "DEMO") {
      if (!feature.demoSupported) {
        return {
          ...base,
          status: "UNAVAILABLE",
          secure: false,
          enabled: false,
          reason: "This capability requires live infrastructure."
        };
      }

      return {
        ...base,
        status: "DEMO",
        secure: false,
        enabled: true,
        reason: "Interactive mock behavior only. No production security claim."
      };
    }

    if (feature.authRequired && !authenticated) {
      return {
        ...base,
        status: "UNAVAILABLE",
        secure: false,
        enabled: false,
        reason: "Authentication required."
      };
    }

    if (feature.serverRequired && !server.ready) {
      return {
        ...base,
        status: mode === "HYBRID" && feature.demoSupported ? "DEGRADED" : "UNAVAILABLE",
        secure: false,
        enabled: mode === "HYBRID" && feature.demoSupported,
        reason: "Server unavailable."
      };
    }

    if (feature.coreRequired && !core.ready) {
      return {
        ...base,
        status: mode === "HYBRID" && feature.demoSupported ? "DEGRADED" : "UNAVAILABLE",
        secure: false,
        enabled: mode === "HYBRID" && feature.demoSupported,
        reason: "Secure cryptographic core unavailable."
      };
    }

    if (feature.secureRequired && !core.secure) {
      return {
        ...base,
        status: "FAILED",
        secure: false,
        enabled: false,
        reason: "Core is present but did not confirm secure operation."
      };
    }

    return {
      ...base,
      status: "READY",
      secure: feature.secureRequired ? core.secure : true,
      enabled: true,
      version: core.apiVersion ?? server.version
    };
  }

  private async safeServerProbe() {
    try {
      return await this.server.health();
    } catch {
      return { reachable: false, ready: false };
    }
  }

  private async safeCoreProbe() {
    try {
      return await this.core.info();
    } catch {
      return { reachable: false, ready: false, secure: false };
    }
  }

  private async safeAuthProbe() {
    try {
      return await this.auth.current();
    } catch {
      return { authenticated: false };
    }
  }
}
