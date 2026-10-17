import { currencyMinorDigits } from "./money.js";

export type DeliveryOption = "standard" | "instant";
export const DELIVERY_OPTIONS: readonly DeliveryOption[] = ["standard", "instant"];

/** Instant delivery fee: 1.85% of the amount, never less than $0.30 (or the same 0.30 in the currency's minor units). */
export const INSTANT_FEE_BPS = 185n;
const MIN_FEE_MAJOR_CENTS = 30n; // 0.30 expressed in hundredths

/**
 * Sender fee in minor units, integer math only (no floating point).
 * Standard delivery is free. Instant is max(1.85% of the amount rounded half-up to the minor unit, the minimum fee).
 * The minimum is 0.30 in the currency: 30 for 2-decimal currencies, 300 for 3-decimal ones, 0 or 1 for 0-decimal ones.
 */
export function calculateSenderFeeMinor(amountMinor: bigint, currency: string, deliveryOption: DeliveryOption): bigint {
  if (amountMinor <= 0n) throw new Error("AMOUNT_MUST_BE_POSITIVE");
  if (deliveryOption !== "instant") return 0n;
  const percentage = (amountMinor * INSTANT_FEE_BPS + 5_000n) / 10_000n;
  const digits = currencyMinorDigits(currency.toUpperCase());
  // 0.30 * 10^digits, rounded half-up (30 for 2 digits, 300 for 3, 3 for 1, 0 for 0).
  const minimum = (MIN_FEE_MAJOR_CENTS * 10n ** BigInt(digits) + 50n) / 100n;
  return percentage > minimum ? percentage : minimum;
}

/** What the sender pays in total: the amount being sent plus the sender fee. */
export function totalChargedMinor(amountMinor: bigint, currency: string, deliveryOption: DeliveryOption): bigint {
  return amountMinor + calculateSenderFeeMinor(amountMinor, currency, deliveryOption);
}
