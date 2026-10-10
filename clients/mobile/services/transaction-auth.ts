import { router } from "expo-router";

export type TransactionAuthRequest = { amountLabel: string; recipientName: string };
export type TransactionAuthResult = "AUTHORIZED" | "CANCELED";

let pending: { request: TransactionAuthRequest; resolve: (result: TransactionAuthResult) => void } | null = null;

/**
 * Asks the person to confirm a transfer on this device (biometrics or their
 * 6-digit PIN) and resolves when they have. The caller does not continue
 * until it resolves, so the device signing key is never used without it.
 */
export function requestTransactionAuth(request: TransactionAuthRequest): Promise<TransactionAuthResult> {
  // A second request cancels the first rather than leaving it hanging.
  pending?.resolve("CANCELED");
  return new Promise((resolve) => {
    pending = { request, resolve };
    router.push("/linqasend/authorize");
  });
}

export function currentTransactionAuth(): TransactionAuthRequest | null {
  return pending?.request ?? null;
}

export function finishTransactionAuth(result: TransactionAuthResult): void {
  const active = pending;
  pending = null;
  active?.resolve(result);
}
