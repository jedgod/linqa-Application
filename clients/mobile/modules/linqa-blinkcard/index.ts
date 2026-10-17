import { requireOptionalNativeModule } from "expo-modules-core";

export type ScannedCard = {
  number: string;
  /** 1-12, or null when the expiry was not read. */
  expMonth: number | null;
  /** Four-digit year, or null when the expiry was not read. */
  expYear: number | null;
  cvv: string | null;
  holderName: string | null;
  issuingNetwork: string | null;
};

export type CardScanOutcome = { status: "scanned"; card: ScannedCard } | { status: "canceled" };

type BlinkCardNative = {
  scanCard(licenseKey: string): Promise<CardScanOutcome>;
};

/** Native scanner, or null when this build does not include the BlinkCard SDK (Expo Go, web). */
export function blinkCardModule(): BlinkCardNative | null {
  try { return requireOptionalNativeModule<BlinkCardNative>("LinqaBlinkCard"); } catch { return null; }
}

/**
 * Opens the BlinkCard camera UI. Resolves with the card read on-device, or "canceled".
 * Rejects with a code such as BLINKCARD_SDK_INIT_FAILED. The result holds the full card number
 * and CVV: keep it in memory only, never log or persist it.
 */
export async function scanCard(licenseKey: string): Promise<CardScanOutcome> {
  const native = blinkCardModule();
  if (!native) throw new Error("BLINKCARD_UNAVAILABLE");
  if (!licenseKey) throw new Error("BLINKCARD_LICENSE_MISSING");
  return native.scanCard(licenseKey);
}
