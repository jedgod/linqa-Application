/**
 * A tiny in-process Prometheus text-format registry.
 *
 * The server had no metrics sink at all — `/metrics` only ever reported two
 * HTTP counters — so the Home telemetry contract had nowhere to land. This
 * provides just enough to satisfy it (labelled counters plus summary-style
 * observations) without adding a prom-client dependency, and is deliberately
 * bounded so a high-cardinality label can't grow without limit.
 */

export interface MetricsSink {
  increment(name: string, labels?: Record<string, string | number | boolean>): void;
  observe(name: string, value: number, labels?: Record<string, string | number | boolean>): void;
}

// Guard against unbounded series growth: a provider `reason` label is derived
// from upstream error text, and an upstream that returns novel messages could
// otherwise grow this map forever.
const MAX_SERIES_PER_METRIC = 200;

type Summary = { count: number; sum: number; min: number; max: number };

function labelKey(labels?: Record<string, string | number | boolean>): string {
  if (!labels) return "";
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value).slice(0, 120)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, " ")}"`)
    .join(",");
}

export class MetricsRegistry implements MetricsSink {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly summaries = new Map<string, Map<string, Summary>>();

  increment(name: string, labels?: Record<string, string | number | boolean>): void {
    const series = this.counters.get(name) ?? new Map<string, number>();
    const key = labelKey(labels);
    if (!series.has(key) && series.size >= MAX_SERIES_PER_METRIC) return;
    series.set(key, (series.get(key) ?? 0) + 1);
    this.counters.set(name, series);
  }

  observe(name: string, value: number, labels?: Record<string, string | number | boolean>): void {
    if (!Number.isFinite(value)) return;
    const series = this.summaries.get(name) ?? new Map<string, Summary>();
    const key = labelKey(labels);
    const existing = series.get(key);
    if (!existing && series.size >= MAX_SERIES_PER_METRIC) return;
    if (existing) {
      existing.count += 1;
      existing.sum += value;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
    } else {
      series.set(key, { count: 1, sum: value, min: value, max: value });
    }
    this.summaries.set(name, series);
  }

  /** Current values, for tests and for the health endpoint. */
  snapshot(): { counters: Record<string, Record<string, number>>; summaries: Record<string, Record<string, Summary>> } {
    const counters: Record<string, Record<string, number>> = {};
    for (const [name, series] of this.counters) {
      counters[name] = Object.fromEntries(series);
    }
    const summaries: Record<string, Record<string, Summary>> = {};
    for (const [name, series] of this.summaries) {
      summaries[name] = Object.fromEntries(series);
    }
    return { counters, summaries };
  }

  render(): string[] {
    const lines: string[] = [];
    for (const [name, series] of [...this.counters].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`# TYPE ${name} counter`);
      for (const [key, value] of series) {
        lines.push(key ? `${name}{${key}} ${value}` : `${name} ${value}`);
      }
    }
    for (const [name, series] of [...this.summaries].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`# TYPE ${name} summary`);
      for (const [key, summary] of series) {
        const suffix = key ? `{${key}}` : "";
        lines.push(`${name}_count${suffix} ${summary.count}`);
        lines.push(`${name}_sum${suffix} ${summary.sum}`);
        lines.push(`${name}_min${suffix} ${summary.min}`);
        lines.push(`${name}_max${suffix} ${summary.max}`);
      }
    }
    return lines;
  }
}
