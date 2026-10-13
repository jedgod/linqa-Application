// Tamper-evident audit chain.
//
// Every event stores the hash of the previous event for the same media item,
// and its own hash = HMAC-SHA256(AUDIT_SECRET, canonical JSON of the event).
// Editing, deleting or reordering any row breaks the chain, and because the
// hash is keyed, someone with database access alone cannot recompute it.

import { createHmac } from 'node:crypto';

export type ChainEvent = {
  mediaId: string;
  seq: number;
  type: string;
  actorId: string | null;
  viewNumber: number | null;
  at: Date;
  detail: unknown;
  prevHash: string | null;
};

/** JSON with sorted keys, so the same event always produces the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function secret(): string {
  const s = process.env.AUDIT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUDIT_SECRET must be set to at least 32 random characters.');
  }
  return s;
}

export function hashEvent(e: ChainEvent, key = secret()): string {
  return createHmac('sha256', key).update(canonicalJson(e)).digest('hex');
}

export type ChainCheck =
  | { valid: true; events: number }
  | { valid: false; brokenAtSeq: number; reason: string };

/** Verify a full chain. `rows` must be every event for one media item. */
export function verifyChain(
  rows: (ChainEvent & { hash: string })[],
  key = secret(),
): ChainCheck {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  let prev: string | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.seq !== i + 1) return { valid: false, brokenAtSeq: r.seq, reason: 'Missing or reordered event' };
    if (r.prevHash !== prev) return { valid: false, brokenAtSeq: r.seq, reason: 'Previous-hash link broken' };
    const expected = hashEvent(
      {
        mediaId: r.mediaId,
        seq: r.seq,
        type: r.type,
        actorId: r.actorId,
        viewNumber: r.viewNumber,
        at: r.at,
        detail: r.detail ?? null,
        prevHash: r.prevHash,
      },
      key,
    );
    if (expected !== r.hash) return { valid: false, brokenAtSeq: r.seq, reason: 'Event contents changed' };
    prev = r.hash;
  }
  return { valid: true, events: sorted.length };
}
