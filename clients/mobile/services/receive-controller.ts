import type { Payload } from "./conversation-engine";
import type { MessageBody, ServerRow } from "./conversation-types";

export type ReceiveScope = { accountId: string; deviceId: string; conversationId: string };

/**
 * What the controller needs from the secure core. `readOrOpenAndCommit` must return text only once the message is safely opened;
 * a durable build also commits an encrypted local copy and the replay update atomically before returning (see
 * Linqa_Items_2_3_Patch/APPLY.md). The app's current adapter (conversation receive in useConversation) is NOT durable.
 */
export interface ReceiveAdapter {
  readOrOpenAndCommit(scope: ReceiveScope, row: ServerRow): Promise<string>;
  classify(error: unknown): "transient" | "blocked";
  safeCode(error: unknown): string;
  markRead(scope: ReceiveScope, upToMessageId: string): Promise<void>;
}

type Failure = { kind: "retryable" | "blocked"; code: string; revision?: string; attempts: number };
const MAX_AUTOMATIC_ATTEMPTS = 3;

/** Opened-message memory, retry state and generation checks for one conversation screen. */
export class ReceiveController {
  private generation = 0;
  private live = false;
  private scope: Readonly<ReceiveScope> | null = null;
  private lastReceipt: string | null = null;
  readonly bodies = new Map<string, MessageBody>();
  private readonly failures = new Map<string, Failure>();
  private readonly inflight = new Set<string>();
  private readonly forgotten = new Set<string>();

  constructor(private readonly adapter: ReceiveAdapter, private readonly parse: (text: string) => Payload | null, private readonly changed: () => void = () => {}) {}

  /** Starts a new generation: everything held for the old scope or gate state is dropped before anything can paint. */
  enter(scope: ReceiveScope, live: boolean) {
    ++this.generation;
    this.scope = Object.freeze({ ...scope });
    this.live = live;
    this.bodies.clear(); this.failures.clear(); this.inflight.clear(); this.forgotten.clear();
    this.lastReceipt = null;
    this.changed();
  }

  private token() { return { generation: this.generation, scope: this.scope }; }
  private valid(t: { generation: number; scope: Readonly<ReceiveScope> | null }) { return this.live && t.generation === this.generation && t.scope === this.scope; }

  /** An outgoing message already known to this device needs no opening. */
  seed(id: string, payload: Payload) { if (this.live && !this.forgotten.has(id)) { this.bodies.set(id, { state: "open", payload }); this.changed(); } }

  forget(id: string) { if(this.forgotten.has(id))return;this.forgotten.add(id); this.bodies.delete(id); this.failures.delete(id); this.changed(); }

  async open(row: ServerRow, { explicit = false, keyRevision }: { explicit?: boolean; keyRevision?: string } = {}): Promise<void> {
    if (!this.live || !this.scope || this.forgotten.has(row.id) || this.bodies.has(row.id) || this.inflight.has(row.id)) return;
    const previous = this.failures.get(row.id);
    if (previous?.kind === "blocked") return;
    if (previous && !explicit && (!keyRevision || keyRevision === previous.revision || previous.attempts >= MAX_AUTOMATIC_ATTEMPTS)) return;
    const t = this.token();
    this.inflight.add(row.id);
    try {
      const text = await this.adapter.readOrOpenAndCommit(t.scope!, row);
      if (!this.valid(t) || this.forgotten.has(row.id)) return;
      const payload = this.parse(text);
      if (!payload) { this.failures.set(row.id, { kind: "blocked", code: "INVALID_PAYLOAD", attempts: 1 }); return; }
      this.bodies.set(row.id, { state: "open", payload });
      this.failures.delete(row.id);
    } catch (error) {
      if (!this.valid(t) || this.forgotten.has(row.id)) return;
      this.failures.set(row.id, {
        kind: this.adapter.classify(error) === "transient" ? "retryable" : "blocked",
        code: this.adapter.safeCode(error), ...(keyRevision ? { revision: keyRevision } : {}),
        attempts: (previous?.attempts ?? 0) + 1
      });
    } finally {
      // Old work must not clear a newer generation's in-flight marker.
      if (this.valid(t)) { this.inflight.delete(row.id); this.changed(); }
    }
  }

  /** What to render: opened bodies, plus an unreadable marker (with Try again when it may clear) for every row that failed. */
  view(): Record<string, MessageBody> {
    const out: Record<string, MessageBody> = Object.fromEntries(this.bodies);
    for (const [id, f] of this.failures) if (!out[id]) out[id] = f.kind === "retryable" ? { state: "unreadable", retryable: true, code: f.code } : { state: "unreadable", code: f.code };
    return out;
  }

  body(id: string): MessageBody { return this.bodies.get(id) ?? { state: "unreadable" }; }
  retryable(id: string) { return this.failures.get(id)?.kind === "retryable" && !this.inflight.has(id); }
  /** True once an attempt has failed (so the row is unreadable, not merely not yet tried). */
  failed(id: string) { return this.failures.has(id); }

  /** Acknowledges up to the newest incoming row, but never past one that has not been opened. Oldest to newest. */
  async markOpenedRead(rows: ServerRow[], selfId: string): Promise<void> {
    const t = this.token();
    if (!this.valid(t)) return;
    let last: string | undefined;
    for (const row of rows) {
      if (row.senderId === selfId) continue;
      if (!this.bodies.has(row.id)) break;
      last = row.id;
    }
    if (!last || last === this.lastReceipt) return;
    await this.adapter.markRead(t.scope!, last);
    if (this.valid(t)) this.lastReceipt = last;
  }
}
