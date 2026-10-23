import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerWalletV2Routes } from '../routes/linqasend/wallet-v2-routes.js';
import type { IdempotencyDecision } from '../services/linqasend/wallet-idempotency.service.js';

/** Same contract as WalletIdempotencyService, held in memory so the route behavior can be tested without PostgreSQL. */
function memoryIdempotency() {
  const rows = new Map<string, { id: string; hash: string; status: 'PROCESSING' | 'COMPLETED'; code?: number; body?: unknown }>();
  let next = 0;
  return {
    rows,
    unavailable: false,
    async begin(userId: string, key: string, _method: string, _path: string, hash: string): Promise<IdempotencyDecision> {
      if (this.unavailable) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      const k = `${userId}:${key}`, row = rows.get(k);
      if (!row) { const id = `row-${++next}`; rows.set(k, { id, hash, status: 'PROCESSING' }); return { kind: 'execute', id }; }
      if (row.hash !== hash) return { kind: 'mismatch' };
      return row.status === 'COMPLETED' ? { kind: 'replay', code: row.code!, body: row.body } : { kind: 'in_progress' };
    },
    async complete(id: string, code: number, body: unknown) {
      for (const [k, row] of rows) if (row.id === id) { if (code >= 200 && code < 300 && body !== undefined) Object.assign(row, { status: 'COMPLETED', code, body }); else rows.delete(k); }
    },
    async abort(id: string) { for (const [k, row] of rows) if (row.id === id && row.status === 'PROCESSING') rows.delete(k); }
  };
}

describe('standalone /v2/wallet routes forward to the audited /v1 wallet handlers', () => {
  let app: FastifyInstance;
  const store = memoryIdempotency();
  let quoteCalls = 0;
  const seen: Array<{ method: string; url: string; authorization?: string; installation?: string; body: unknown; ip: string }> = [];

  beforeAll(async () => {
    app = Fastify();
    const record = (req: any, body?: unknown) => seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, installation: req.headers['x-installation-id'], body, ip: req.ip });
    app.get('/v1/linqasend/wallets', async (req) => { record(req); return { items: [] }; });
    app.get('/v1/linqasend/wallets/:id/activity', async (req) => { record(req); return { id: (req.params as any).id }; });
    app.get('/v1/linqasend/wallet-money/operations/:id', async (req) => { record(req); return { id: (req.params as any).id }; });
    app.get('/v1/linqasend/wallet-profile', async (req) => { record(req); return { serviceAvailable: true }; });
    app.get('/v1/linqasend/wallet-money/targets', async (req) => { record(req); return { items: [] }; });
    app.post('/v1/linqasend/wallet-money/quotes/:id/submit', async (req, reply) => { record(req, req.body); return reply.code(409).send({ error: 'WALLET_MONEY_RELEASE_NOT_READY' }); });
    app.post('/v1/linqasend/wallet-money/quotes', async (req, reply) => {
      quoteCalls++;
      const body = req.body as { amountMinor?: string };
      if (body.amountMinor === '999') return reply.code(409).send({ error: 'WALLET_REQUEST_DENIED' });
      await new Promise((r) => setTimeout(r, 150));
      return { id: `quote-${quoteCalls}` };
    });
    // Pre-existing Cards & Passes vault route must keep working next to the new subpaths.
    app.get('/v2/wallet', async () => ({ vault: true }));
    await registerWalletV2Routes(app, {} as never, {} as never, { authenticate: async (r) => { if (!r.headers.authorization) throw new Error('no'); return { userId: 'user-1' }; }, idempotency: store });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('forwards GET with credentials, query string and the caller address', async () => {
    const res = await app.inject({ method: 'GET', url: '/v2/wallet/money/targets?kind=TOPUP', headers: { authorization: 'Bearer abc' }, remoteAddress: '203.0.113.9' });
    expect(res.statusCode).toBe(200);
    expect(seen.at(-1)).toMatchObject({ method: 'GET', url: '/v1/linqasend/wallet-money/targets?kind=TOPUP', authorization: 'Bearer abc', ip: '203.0.113.9' });
  });

  it('substitutes path parameters safely', async () => {
    const res = await app.inject({ method: 'GET', url: '/v2/wallet/balances/abc-123/activity', headers: { authorization: 'Bearer abc' } });
    expect(res.json()).toEqual({ id: 'abc-123' });
  });

  it('forwards POST bodies and custom headers, and passes through the handler status and error', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const res = await app.inject({
      method: 'POST', url: `/v2/wallet/money/quotes/${id}/submit`,
      headers: { authorization: 'Bearer abc', 'x-installation-id': 'inst-1', 'content-type': 'application/json' },
      payload: { challengeId: 'c', biometricGrantId: 'g' }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'WALLET_MONEY_RELEASE_NOT_READY' });
    expect(seen.at(-1)).toMatchObject({ installation: 'inst-1', body: { challengeId: 'c', biometricGrantId: 'g' } });
  });

  it('serves the read-only fee schedule to authenticated callers only', async () => {
    expect((await app.inject({ method: 'GET', url: '/v2/wallet/fees' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/v2/wallet/fees', headers: { authorization: 'Bearer abc' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 1, schedules: { USD: { INTERNAL: { bps: 1000, minMinor: '45' }, EXTERNAL: { bps: 1599, minMinor: '65' } } } });
  });

  it('forwards a single-operation lookup with its id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v2/wallet/money/operations/op-9', headers: { authorization: 'Bearer abc' } });
    expect(res.json()).toEqual({ id: 'op-9' });
  });

  it('forwards the wallet country and currency profile', async () => {
    const res = await app.inject({ method: 'GET', url: '/v2/wallet/profile', headers: { authorization: 'Bearer abc' } });
    expect(res.json()).toEqual({ serviceAvailable: true });
    expect(seen.at(-1)).toMatchObject({ url: '/v1/linqasend/wallet-profile', authorization: 'Bearer abc' });
  });

  it('does not shadow the existing /v2/wallet vault route', async () => {
    expect((await app.inject({ method: 'GET', url: '/v2/wallet' })).json()).toEqual({ vault: true });
  });

  describe('optional Idempotency-Key', () => {
    const post = (key: string | undefined, amountMinor = '100', auth = true) => app.inject({
      method: 'POST', url: '/v2/wallet/money/quotes',
      headers: { ...(auth ? { authorization: 'Bearer abc' } : {}), 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      payload: { walletId: 'w', amountMinor }
    });

    it('runs once and replays the stored response for the same key and request', async () => {
      const before = quoteCalls;
      const first = await post('retry-key-0000000001');
      const second = await post('retry-key-0000000001');
      expect(first.json()).toEqual(second.json());
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(quoteCalls - before).toBe(1);
    });

    it('makes a concurrent duplicate wait for the first instead of executing twice', async () => {
      const before = quoteCalls;
      const [a, b] = await Promise.all([post('retry-key-0000000002'), post('retry-key-0000000002')]);
      expect(a.json()).toEqual(b.json());
      expect(quoteCalls - before).toBe(1);
    });

    it('refuses the same key with a different request', async () => {
      await post('retry-key-0000000003', '100');
      const res = await post('retry-key-0000000003', '200');
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('does not store denials, so a retry executes again', async () => {
      const before = quoteCalls;
      expect((await post('retry-key-0000000004', '999')).statusCode).toBe(409);
      expect((await post('retry-key-0000000004', '999')).statusCode).toBe(409);
      expect(quoteCalls - before).toBe(2);
      expect(store.rows.has('user-1:retry-key-0000000004')).toBe(false);
    });

    it('rejects a malformed key and leaves requests without a key untouched', async () => {
      expect((await post('short')).statusCode).toBe(422);
      const before = quoteCalls;
      await post(undefined); await post(undefined);
      expect(quoteCalls - before).toBe(2);
    });

    it('does not guard unauthenticated requests; the wallet handler answers them', async () => {
      const before = quoteCalls;
      await post('retry-key-0000000005', '100', false);
      expect(quoteCalls - before).toBe(1);
      expect(store.rows.has('user-1:retry-key-0000000005')).toBe(false);
    });

    it('refuses to run unguarded when the key store is unavailable', async () => {
      store.unavailable = true;
      const before = quoteCalls;
      const res = await post('retry-key-0000000006');
      store.unavailable = false;
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'IDEMPOTENCY_UNAVAILABLE' });
      expect(quoteCalls).toBe(before);
    });
  });
});
