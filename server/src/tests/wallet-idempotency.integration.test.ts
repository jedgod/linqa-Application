import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requestHash, WalletIdempotencyService } from '../services/linqasend/wallet-idempotency.service.js';

// Runs only in the disposable DB created by run-wallet-db-tests.mjs.
const suite = process.env.LINQA_WALLET_DISPOSABLE_TEST_DB === '1' ? describe : describe.skip;
suite('wallet API idempotency on real PostgreSQL', () => {
  let pool: pg.Pool, service: WalletIdempotencyService, userA: string, userB: string;
  const hash = requestHash('POST', '/v2/wallet/money/quotes', { amountMinor: '100' });
  const otherHash = requestHash('POST', '/v2/wallet/money/quotes', { amountMinor: '200' });
  const key = () => `key-${randomUUID()}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    service = new WalletIdempotencyService(pool);
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND is_nullable='NO' AND column_default IS NULL`)).rows.map((r) => r.column_name);
    // Only the primary key is required by the idempotency table's foreign key; fill other required columns if any exist.
    const make = async () => {
      const id = randomUUID();
      const values: Record<string, unknown> = { id };
      for (const c of columns) if (c !== 'id') values[c] = c.includes('email') ? `${id}@example.test` : c === 'status' ? 'ACTIVE' : id.slice(0, 12);
      const names = Object.keys(values);
      await pool.query(`INSERT INTO users(${names.join(',')}) VALUES(${names.map((_, i) => `$${i + 1}`).join(',')})`, names.map((n) => values[n]));
      return id;
    };
    userA = await make();
    userB = await make();
  });
  afterAll(async () => { await pool.end(); });

  it('only one of many concurrent first requests executes', async () => {
    const k = key();
    const results = await Promise.all(Array.from({ length: 12 }, () => service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash)));
    expect(results.filter((r) => r.kind === 'execute')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(11);
  });

  it('replays a stored success and survives JSON round trip', async () => {
    const k = key();
    const first = await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash);
    if (first.kind !== 'execute') throw new Error('expected execute');
    await service.complete(first.id, 200, { id: 'q-1', amountMinor: '9007199254740993' });
    expect(await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash)).toEqual({ kind: 'replay', code: 200, body: { id: 'q-1', amountMinor: '9007199254740993' } });
  });

  it('refuses the same key with a different request, and scopes keys per user', async () => {
    const k = key();
    expect((await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash)).kind).toBe('execute');
    expect((await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', otherHash)).kind).toBe('mismatch');
    expect((await service.begin(userB, k, 'POST', '/v2/wallet/money/quotes', otherHash)).kind).toBe('execute');
  });

  it('does not store failures: abort and non-2xx release the key', async () => {
    const k = key();
    const first = await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash);
    if (first.kind !== 'execute') throw new Error('expected execute');
    await service.complete(first.id, 409, { error: 'WALLET_REQUEST_DENIED' });
    expect((await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash)).kind).toBe('execute');
  });

  it('lets a retry take over a crashed request only after its lease lapses', async () => {
    const k = key();
    const first = await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash);
    if (first.kind !== 'execute') throw new Error('expected execute');
    expect((await service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash)).kind).toBe('in_progress');
    await pool.query(`UPDATE linqasend_wallet_api_idempotency SET lease_expires_at = now() - interval '1 second' WHERE id=$1`, [first.id]);
    const takeovers = await Promise.all(Array.from({ length: 6 }, () => service.begin(userA, k, 'POST', '/v2/wallet/money/quotes', hash)));
    expect(takeovers.filter((r) => r.kind === 'execute')).toHaveLength(1);
  });

  it('purges old completed rows opportunistically but never an in-flight one', async () => {
    const done = key(), live = key();
    const a = await service.begin(userA, done, 'POST', '/v2/wallet/money/quotes', hash);
    const b = await service.begin(userA, live, 'POST', '/v2/wallet/money/quotes', hash);
    if (a.kind !== 'execute' || b.kind !== 'execute') throw new Error('expected execute');
    await service.complete(a.id, 200, { ok: true });
    await pool.query(`UPDATE linqasend_wallet_api_idempotency SET created_at = now() - interval '2 days' WHERE id IN ($1,$2)`, [a.id, b.id]);
    await service.begin(userA, key(), 'POST', '/v2/wallet/money/quotes', hash);
    const remaining = (await pool.query(`SELECT id FROM linqasend_wallet_api_idempotency WHERE id IN ($1,$2)`, [a.id, b.id])).rows.map((r) => r.id);
    expect(remaining).toEqual([b.id]);
  });
});
