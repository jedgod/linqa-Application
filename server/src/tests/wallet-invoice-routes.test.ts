import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerWalletV2Routes } from '../routes/linqasend/wallet-v2-routes.js';
import { hashInvoiceCode, invoiceCodeHint } from '../services/linqasend/wallet-invoice.service.js';

describe('one-time invoice routes', () => {
  let app: FastifyInstance;
  const created: unknown[] = [];
  const looked: Array<{ userId: string; code: string }> = [];
  const scopesFor = (token: string | undefined): string[] | null =>
    token === 'Bearer rw' ? ['linqasend:read', 'linqasend:write'] : token === 'Bearer ro' ? ['linqasend:read'] : null;

  beforeAll(async () => {
    app = Fastify();
    await registerWalletV2Routes(app, {} as never, {} as never, {
      authenticate: async () => ({ userId: 'user-1' }),
      idempotency: { begin: async () => { throw new Error('invoice routes must not use the idempotency store'); }, complete: async () => undefined, abort: async () => undefined },
      principal: async (request) => {
        const scopes = scopesFor(request.headers.authorization);
        if (!scopes) throw new Error('no');
        return { subject: 's', userId: 'user-1', scopes: new Set(scopes) };
      },
      invoices: {
        create: async (userId, input) => {
          created.push({ userId, input });
          if (input.currency === 'XXX') throw new Error('WALLET_CURRENCY_NOT_AVAILABLE');
          if (input.currency === 'EUR') throw new Error('INVOICE_LIMIT_REACHED');
          if (input.currency === 'GBP') throw new Error('connection to database lost: secret detail');
          return { id: 'i1', code: 'inv_abcdef123456', merchantName: 'You', baseAmountMinor: input.amountMinor, currency: input.currency, expiresAt: '2026-10-23T03:34:00.000Z' };
        },
        lookup: async (userId, code) => {
          looked.push({ userId, code });
          if (code === 'inv_paid00000000') throw new Error('INVOICE_ALREADY_PAID');
          if (code === 'inv_mine00000000') throw new Error('INVOICE_OWN');
          return { id: 'i1', code, merchantName: 'Linqa user', baseAmountMinor: '2450', currency: 'USD', expiresAt: '2026-10-23T03:34:00.000Z' };
        }
      }
    });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const post = (payload: unknown, token = 'Bearer rw') => app.inject({ method: 'POST', url: '/v2/wallet/invoices', headers: { authorization: token }, payload: payload as object });
  const body = { currency: 'USD', amountMinor: '2450', ttlSeconds: 900 };

  it('creates an invoice for the signed-in user and returns the code once, uncached', async () => {
    const res = await post(body);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ id: 'i1', code: 'inv_abcdef123456', baseAmountMinor: '2450', currency: 'USD' });
    expect(created.at(-1)).toEqual({ userId: 'user-1', input: body });
  });

  it('does not touch the idempotency store, even when a key is sent', async () => {
    const res = await app.inject({ method: 'POST', url: '/v2/wallet/invoices', headers: { authorization: 'Bearer rw', 'idempotency-key': 'wallet-request-12345678' }, payload: body });
    expect(res.statusCode).toBe(201);
  });

  it('requires sign-in and the write scope to create, and the read scope to look up', async () => {
    expect((await post(body, 'Bearer none')).statusCode).toBe(401);
    expect((await post(body, 'Bearer ro')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v2/wallet/invoices/lookup?code=inv_abcdef123456' })).statusCode).toBe(401);
  });

  it.each([
    ['float amount', { ...body, amountMinor: '24.50' }],
    ['zero amount', { ...body, amountMinor: '0' }],
    ['numeric amount (must be a string of minor units)', { ...body, amountMinor: 2450 }],
    ['lowercase currency', { ...body, currency: 'usd' }],
    ['too short a lifetime', { ...body, ttlSeconds: 30 }],
    ['too long a lifetime', { ...body, ttlSeconds: 86_400 }],
    ['unknown field', { ...body, recipientUserId: 'x' }]
  ])('rejects %s', async (_name, payload) => {
    const before = created.length;
    const res = await post(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'INVALID_INVOICE_REQUEST' });
    expect(created.length).toBe(before);
  });

  it('maps known failures to stable codes and hides unknown ones', async () => {
    expect(await post({ ...body, currency: 'XXX' }).then((r) => [r.statusCode, r.json()])).toEqual([409, { error: 'WALLET_CURRENCY_NOT_AVAILABLE' }]);
    expect(await post({ ...body, currency: 'EUR' }).then((r) => [r.statusCode, r.json()])).toEqual([429, { error: 'INVOICE_LIMIT_REACHED' }]);
    const res = await post({ ...body, currency: 'GBP' });
    expect(res.statusCode).toBe(503);
    expect(res.payload).not.toContain('secret detail');
  });

  it('looks up a code for the signed-in payer and passes the code through', async () => {
    const res = await app.inject({ method: 'GET', url: '/v2/wallet/invoices/lookup?code=inv_abcdef123456', headers: { authorization: 'Bearer ro' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: 'inv_abcdef123456', baseAmountMinor: '2450', currency: 'USD' });
    expect(looked.at(-1)).toEqual({ userId: 'user-1', code: 'inv_abcdef123456' });
  });

  it('reports a paid invoice and an own invoice distinctly, and needs a code', async () => {
    const lookup = (qs: string) => app.inject({ method: 'GET', url: `/v2/wallet/invoices/lookup${qs}`, headers: { authorization: 'Bearer ro' } });
    expect(await lookup('?code=inv_paid00000000').then((r) => [r.statusCode, r.json()])).toEqual([409, { error: 'INVOICE_ALREADY_PAID' }]);
    expect(await lookup('?code=inv_mine00000000').then((r) => [r.statusCode, r.json()])).toEqual([409, { error: 'INVOICE_OWN' }]);
    expect((await lookup('')).statusCode).toBe(422);
  });
});

describe('invoice code storage', () => {
  it('stores a SHA-256 of the code and a hint that cannot be used to pay', () => {
    const code = 'inv_0123456789abcdef0123456789abcdef';
    expect(hashInvoiceCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvoiceCode(code)).not.toContain(code);
    expect(invoiceCodeHint(code)).toBe('inv_012...cdef');
    expect(hashInvoiceCode(code)).not.toBe(hashInvoiceCode(code + 'x'));
  });
});
