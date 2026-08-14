import type { CapabilityState } from "../runtime/capabilities.js";

export interface ProviderHealth { state: CapabilityState; identity: string; reason?: string; }
export interface Provider {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  health(): Promise<ProviderHealth>;
  readonly value?: unknown;
}

export class ProviderRegistry {
  private providers = new Map<string, Provider>();
  register(provider: Provider): this {
    if (this.providers.has(provider.kind)) throw new Error(`Provider already registered: ${provider.kind}`);
    this.providers.set(provider.kind, provider);
    return this;
  }
  get<T extends Provider>(kind: string): T {
    const provider = this.providers.get(kind);
    if (!provider) throw new Error(`Provider not configured: ${kind}`);
    return provider as T;
  }
  maybe<T extends Provider>(kind: string): T | undefined { return this.providers.get(kind) as T | undefined; }
  list(): Provider[] { return [...this.providers.values()]; }
  resolve<T>(kind: string): T {
    const provider = this.get<Provider>(kind);
    if (provider.value === undefined) throw new Error(`Provider has no runtime implementation: ${kind}`);
    return provider.value as T;
  }
}

export class OperationalProvider<T> implements Provider {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly version: string,
    readonly value: T,
    private readonly check: () => Promise<ProviderHealth>
  ) {}
  health(): Promise<ProviderHealth> { return this.check(); }
}

export class ConfigurationProvider implements Provider {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly version: string,
    private readonly configured: boolean,
    private readonly missingReason = "provider missing"
  ) {}
  async health(): Promise<ProviderHealth> {
    return this.configured
      ? { state: "READY", identity: this.id }
      : { state: "NOT_CONFIGURED", identity: this.id, reason: this.missingReason };
  }
}
