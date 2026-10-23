/**
 * Platform fee schedule for wallet sends. Pure integer math in minor units: no floating point anywhere.
 *
 * INTERNAL  wallet -> Linqa user (same platform):  10.00% of the amount, never below 0.45.
 * EXTERNAL  wallet -> outside recipient:           15.99% of the amount, never below 0.65.
 *
 * A fee is charged on top of the amount: the recipient receives the full amount and the sender is debited
 * amount + fee. A currency without an entry has no schedule; INTERNAL sends in it are refused rather than priced at zero.
 */
type Rule = { bps: bigint; minMinor: bigint };
type Schedule = { INTERNAL: Rule; EXTERNAL: Rule };

const SCHEDULES: Readonly<Record<string, Schedule>> = {
  USD: { INTERNAL: { bps: 1000n, minMinor: 45n }, EXTERNAL: { bps: 1599n, minMinor: 65n } }
};

export type FeeKind = 'INTERNAL' | 'EXTERNAL';

/** Fee in minor units, rounded half up, or null when the currency has no schedule. */
export function scheduledFee(kind: FeeKind, currency: string, amountMinor: string): bigint | null {
  const rule = SCHEDULES[currency]?.[kind];
  if (!rule) return null;
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('WALLET_FEE_AMOUNT_INVALID');
  const percentage = (BigInt(amountMinor) * rule.bps + 5000n) / 10000n;
  return percentage > rule.minMinor ? percentage : rule.minMinor;
}

/** Read-only view of the schedule for client previews. Quotes remain the only source of the fee actually charged. */
export function feeScheduleView(): Record<string, Record<FeeKind, { bps: number; minMinor: string }>> {
  return Object.fromEntries(Object.entries(SCHEDULES).map(([currency, schedule]) => [currency, {
    INTERNAL: { bps: Number(schedule.INTERNAL.bps), minMinor: schedule.INTERNAL.minMinor.toString() },
    EXTERNAL: { bps: Number(schedule.EXTERNAL.bps), minMinor: schedule.EXTERNAL.minMinor.toString() }
  }]));
}
