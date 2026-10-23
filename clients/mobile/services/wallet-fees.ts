/**
 * Estimate of a wallet send fee from the server's read-only schedule (`GET /v2/wallet/fees`). Integer minor units,
 * rounded half up, identical to the server. This is only a preview: the quote at the review step carries the fee that is charged.
 */
export type FeeKind = "INTERNAL" | "EXTERNAL";
export type FeeSchedules = Record<string, Partial<Record<FeeKind, { bps: number; minMinor: string }>>>;
export type FeeEstimate = { feeMinor: bigint; totalMinor: bigint; minimumApplied: boolean };

export function estimateFee(schedules: FeeSchedules | null, kind: FeeKind, currency: string, amountMinor: string | null): FeeEstimate | null {
  const rule = schedules?.[currency]?.[kind];
  if (!rule || !amountMinor || !/^[1-9]\d*$/.test(amountMinor)) return null;
  const amount = BigInt(amountMinor);
  const percentage = (amount * BigInt(rule.bps) + 5000n) / 10000n;
  const minimum = BigInt(rule.minMinor);
  const feeMinor = percentage > minimum ? percentage : minimum;
  return { feeMinor, totalMinor: amount + feeMinor, minimumApplied: percentage <= minimum };
}
