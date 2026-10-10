/** Share of a limit already used, 0..1. Null when there is no limit to measure against. */
export function usedShare(limitMinor: string | null | undefined, usedMinor: string): number | null {
  if (limitMinor === null || limitMinor === undefined) return null;
  const limit = Number(limitMinor);
  if (!(limit > 0)) return null;
  return Math.min(1, Math.max(0, Number(usedMinor) / limit));
}
