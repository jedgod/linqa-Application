import type { LinqaSendProviders } from "./provider.contracts.js";
import { safeDefaultLinqaSendProviders } from "./safe-default.providers.js";

let current: LinqaSendProviders = safeDefaultLinqaSendProviders();

/**
 * The single seam a real KYC/compliance/funding/payout integration plugs
 * into later, and the seam tests use to substitute fakes — without either
 * touching `TransferOrchestratorService`'s constructor signature per
 * provider or standing up a second, parallel orchestrator. Defaults to the
 * fail-closed providers, so an unconfigured environment behaves exactly as
 * it did before this registry existed.
 */
export function configureLinqaSendProviders(providers: Partial<LinqaSendProviders>): void {
  current = { ...current, ...providers };
}

export function getLinqaSendProviders(): LinqaSendProviders {
  return current;
}

export function resetLinqaSendProvidersToSafeDefaults(): void {
  current = safeDefaultLinqaSendProviders();
}
