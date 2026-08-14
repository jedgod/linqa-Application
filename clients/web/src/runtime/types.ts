export type RuntimeMode = "DEMO" | "HYBRID" | "LIVE";

export type CapabilityStatus =
  | "DISABLED"
  | "DEMO"
  | "LOADING"
  | "READY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "FAILED";

export type LinqaStage =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
  | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

export interface CapabilityState {
  key: string;
  stage: LinqaStage;
  status: CapabilityStatus;
  secure: boolean;
  enabled: boolean;
  reason?: string;
  version?: string;
  checkedAt: string;
}

export interface RuntimeSnapshot {
  mode: RuntimeMode;
  authenticated: boolean;
  userId?: string;
  deviceId?: string;
  serverReachable: boolean;
  coreReachable: boolean;
  capabilities: Record<string, CapabilityState>;
  warnings: string[];
  updatedAt: string;
}

export interface RuntimeFeatureDefinition {
  key: string;
  stage: LinqaStage;
  secureRequired: boolean;
  serverRequired: boolean;
  authRequired: boolean;
  coreRequired: boolean;
  demoSupported: boolean;
}
