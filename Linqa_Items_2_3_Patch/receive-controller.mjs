/** Adapter must never persist plaintext unencrypted. See APPLY.md. */
export class ReceiveController {
  constructor(adapter, parse, changed = () => {}) {
    this.adapter = adapter; this.parse = parse; this.changed = changed;
    this.generation = 0; this.live = false; this.scope = null;
    this.bodies = new Map(); this.failures = new Map(); this.inflight = new Set();
  }
  enter(scope, live) {
    ++this.generation;
    this.scope = Object.freeze({ ...scope }); this.live = live;
    this.bodies.clear(); this.failures.clear(); this.inflight.clear();
    this.changed();
  }
  token() { return { generation: this.generation, scope: this.scope }; }
  valid(t) { return this.live && t.generation === this.generation && t.scope === this.scope; }
  async open(row, { explicit = false, keyRevision } = {}) {
    if (!this.live || this.bodies.has(row.id) || this.inflight.has(row.id)) return;
    const previous = this.failures.get(row.id);
    if (previous?.kind === 'blocked') return;
    if (previous && !explicit) {
      if (!keyRevision || keyRevision === previous.revision || previous.attempts >= 3) return;
    }
    const t = this.token(); const flight = `${t.generation}:${row.id}`;
    this.inflight.add(row.id);
    try {
      // Returns a locally decrypted cache entry, or atomically opens AND commits
      // encrypted inbox + replay state. Resolves only after durable commit.
      const text = await this.adapter.readOrOpenAndCommit(t.scope, row);
      if (!this.valid(t)) return;
      const payload = this.parse(text);
      if (!payload) { this.failures.set(row.id, { kind: 'blocked', code: 'INVALID_PAYLOAD' }); return; }
      this.bodies.set(row.id, { state: 'open', payload }); this.failures.delete(row.id);
    } catch (error) {
      if (!this.valid(t)) return;
      const classification = this.adapter.classify(error);
      this.failures.set(row.id, {
        kind: classification === 'transient' ? 'retryable' : 'blocked',
        code: this.adapter.safeCode(error), revision: keyRevision,
        attempts: (previous?.attempts ?? 0) + 1
      });
    } finally {
      // Old work must not clear a new generation's in-flight marker.
      if (this.valid(t)) { this.inflight.delete(row.id); this.changed(); }
    }
  }
  body(id) { return this.bodies.get(id) ?? { state: 'unreadable' }; }
  retryable(id) { return this.failures.get(id)?.kind === 'retryable'; }
  async markOpenedRead(rows, selfId) {
    const t = this.token(); if (!this.valid(t)) return;
    // Preserve server order. Stop at first unopened incoming row if receipts
    // acknowledge all messages up to an ID.
    let last;
    for (const row of rows) {
      if (row.senderId === selfId) continue;
      if (!this.bodies.has(row.id)) break;
      last = row.id;
    }
    if (last && this.valid(t)) await this.adapter.markRead(t.scope, last);
  }
}
