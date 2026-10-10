/** Bounds partial data-channel messages by count, size and lifetime. */
export const WIRE_CHUNK = 15_000;
export class WireAssembler {
  private partial = new Map<string, { n: number; parts: (string | undefined)[]; at: number; size: number }>();
  clear() { this.partial.clear(); }
  accept(raw: string, now = Date.now()): unknown | null {
    if (typeof raw !== "string" || raw.length > WIRE_CHUNK * 2) return null;
    for (const [id, entry] of this.partial) if (now - entry.at > 30_000) this.partial.delete(id);
    let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
    const m = value as { t?: string; id?: string; i?: number; n?: number; d?: string } | null;
    if (!m || typeof m !== "object") return null;
    if (m.t !== "chunk") return value;
    if (typeof m.id !== "string" || !m.id || m.id.length > 64 || !Number.isInteger(m.i) || !Number.isInteger(m.n) || m.n! < 1 || m.n! > 256 || m.i! < 0 || m.i! >= m.n! || typeof m.d !== "string" || m.d.length > WIRE_CHUNK) return null;
    let entry = this.partial.get(m.id);
    if (!entry) {
      if (this.partial.size >= 4) return null;
      entry = { n: m.n!, parts: new Array(m.n!).fill(undefined), at: now, size: 0 }; this.partial.set(m.id, entry);
    }
    if (entry.n !== m.n || entry.parts[m.i!] !== undefined) { this.partial.delete(m.id); return null; }
    entry.size += m.d.length;
    if (entry.size > 3_840_000) { this.partial.delete(m.id); return null; }
    entry.parts[m.i!] = m.d;
    if (entry.parts.some(p => p === undefined)) return null;
    this.partial.delete(m.id);
    try { const result = JSON.parse(entry.parts.join("")); return result?.t === "chunk" ? null : result; } catch { return null; }
  }
}
