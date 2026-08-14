export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diffMs < min) return "now";
  if (diffMs < hour) return `${Math.floor(diffMs / min)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  return `${Math.floor(diffMs / day)}d`;
}
