/**
 * Integer-only money math (bigint minor units + scaled-integer exchange
 * rates) — never JavaScript floating point, per the LinqaSend pack's core
 * invariant. Rates are represented as a bigint numerator over a fixed
 * denominator (RATE_SCALE) instead of pulling in a decimal library, since
 * none is installed in this server and none of this arithmetic needs
 * fractional precision beyond that scale.
 */
export const RATE_SCALE = 10_000_000_000n; // 10 decimal places of rate precision

export function parseRateToScaled(rate: string): bigint {
  const [wholePart = "0", frac = ""] = rate.split(".");
  const fracPadded = (frac + "0".repeat(10)).slice(0, 10);
  const sign = wholePart.startsWith("-") ? -1n : 1n;
  const wholeAbs = wholePart.replace("-", "") || "0";
  return sign * (BigInt(wholeAbs) * RATE_SCALE + BigInt(fracPadded || "0"));
}

export function scaledRateToString(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / RATE_SCALE;
  const frac = (abs % RATE_SCALE).toString().padStart(10, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** amountMinor * scaledRate / RATE_SCALE, rounded half-up. */
export function currencyMinorDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_CURRENCY");
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function convertMinor(amountMinor: bigint, scaledRate: bigint, sourceDigits = 2, destinationDigits = 2): bigint {
  const product = amountMinor * scaledRate * 10n ** BigInt(destinationDigits);
  const denominator = RATE_SCALE * 10n ** BigInt(sourceDigits);
  return (product + denominator / 2n) / denominator;
}

export function applyMarginToScaledRate(scaledExecutionRate: bigint, marginBps: number): bigint {
  if (marginBps < 0 || marginBps > 10_000) throw new Error("INVALID_MARGIN_BPS");
  const bps = BigInt(marginBps);
  return (scaledExecutionRate * (10_000n - bps)) / 10_000n;
}

export function clampMarginBps(raw: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, raw));
}
