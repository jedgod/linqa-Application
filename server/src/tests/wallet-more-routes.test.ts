import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { csvCell, registerWalletMoreRoutes, reportPeriod } from '../routes/linqasend/wallet-more-routes.js';

async function fixture(rows: Record<string, unknown>[] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = { query: async (sql: string, params: unknown[]) => { queries.push({ sql, params }); return { rows }; } };
  const app = Fastify();
  await registerWalletMoreRoutes(app, {} as never, db as never, async r => {
    if (!r.headers.authorization) throw new Error('no session');
    return { userId: String(r.headers['x-test-user'] || 'alice'), subject: 'session', scopes: new Set(r.headers.authorization === 'denied' ? [] : ['linqasend:read']) };
  });
  return { app, queries };
}
describe('authenticated Wallet More services', () => {
  it('requires a session and wallet read permission', async () => {
    const { app, queries } = await fixture();
    try {
      expect((await app.inject('/v2/wallet/services')).statusCode).toBe(401);
      expect((await app.inject({ url: '/v2/wallet/report-options', headers: { authorization: 'denied' } })).statusCode).toBe(403);
      expect(queries).toHaveLength(0);
    } finally { await app.close(); }
  });
  it('reports service availability without card data or profile fields', async () => {
    const { app } = await fixture();
    try {
      const r = await app.inject({ url: '/v2/wallet/services', headers: { authorization: 'session' } });
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.json()).toMatchObject({ cardsRoute: '/linqasend/payment-methods', linkMethodSupported: false, displayCurrencySupported: false });
      expect(r.json().securityOptions).toEqual([]);
      expect(r.json()).not.toHaveProperty('last4');
      expect(r.json()).not.toHaveProperty('balance');
      expect(r.json()).not.toHaveProperty('displayName');
    } finally { await app.close(); }
  });
  it('scopes funding methods to the authenticated user and returns the recorded status', async () => {
    const { app, queries } = await fixture([{ id: 'method', type: 'BANK_ACCOUNT', last4: '1234', verification_status: 'PENDING' }]);
    try {
      const r = await app.inject({ url: '/v2/wallet/funding-methods', headers: { authorization: 'session', 'x-test-user': 'bob' } });
      expect(r.json().items[0].status).toBe('PENDING');
      expect(queries[0]?.params).toEqual(['bob']);
      expect(queries[0]?.sql).toContain('user_id=$1');
      expect(queries[0]?.sql).toContain("('BANK_ACCOUNT','DEBIT_CARD')");
      expect(queries[0]?.sql).not.toContain('provider_payment_method_ref');
    } finally { await app.close(); }
  });
  it('shows wallet policy limits and shared usage without inventing an unlimited allowance', async () => {
    const { app, queries } = await fixture([{ wallet_id: 'wallet', currency: 'USD', status: 'ACTIVE', configured: null, per_operation_minor: null, daily_minor: null, used_minor: '25', remaining_minor: null }]);
    try {
      const r = await app.inject({ url: '/v2/wallet/limits', headers: { authorization: 'session' } });
      expect(r.json()).toMatchObject({ period: 'ROLLING_24_HOURS', includesFees: true, items: [{ walletId: 'wallet', configured: false, perOperationMinor: null, dailyMinor: null, usedMinor: '25', remainingMinor: null }] });
      expect(queries[0]?.params).toEqual(['alice']);
      expect(queries[0]?.sql).toContain('WHERE w.user_id=$1');
      expect(queries[0]?.sql).toContain('linqasend_wallet_money_limits');
      expect(queries[0]?.sql).toContain('linqasend_deposit_requests');
      expect(queries[0]?.sql).toContain('linqasend_transfers');
      expect(queries[0]?.sql).not.toContain('linqasend_launch_cohorts');
    } finally { await app.close(); }
  });
  it('returns a useful empty report state and scopes the UTC month on the server', async () => {
    const { app, queries } = await fixture();
    try {
      const r = await app.inject({ url: '/v2/wallet/reports/2026-02', headers: { authorization: 'session' } });
      expect(r.json()).toEqual({ status: 'EMPTY', filename: null, content: null });
      expect(queries[0]?.params).toEqual(['alice', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']);
      expect(queries[0]?.sql).toContain('WHERE (user_id=$1 OR');
      expect(queries[0]?.sql).toContain('WHERE user_id=$1))');
    } finally { await app.close(); }
  });
  it('rejects invalid periods before database access', async () => {
    const { app, queries } = await fixture();
    try {
      expect((await app.inject({ url: '/v2/wallet/reports/2026-13', headers: { authorization: 'session' } })).statusCode).toBe(422);
      expect(queries).toHaveLength(0);
    } finally { await app.close(); }
  });
  it('exports exact minor units and server statuses without exposing the snapshot', async () => {
    const { app } = await fixture([{ id: 'operation', created_at: '2026-02-12T10:00:00Z', kind: 'INTERNAL', direction: 'RECEIVED', currency: 'USD', amount_minor: '12345678901234567890', status: 'PROCESSING' }]);
    try {
      const r = await app.inject({ url: '/v2/wallet/reports/2026-02', headers: { authorization: 'session' } });
      expect(r.json()).toMatchObject({ status: 'READY', filename: 'wallet-transactions-2026-02.csv' });
      expect(r.json().content).toContain('"12345678901234567890","PROCESSING"');
      expect(r.json().content).toContain('"RECEIVED"');
      expect(r.json().content).not.toContain('snapshot');
    } finally { await app.close(); }
  });
  it('refuses an incomplete export rather than silently truncating it', async () => {
    const { app } = await fixture(Array(10001).fill({}));
    try { expect((await app.inject({ url: '/v2/wallet/reports/2026-02', headers: { authorization: 'session' } })).json()).toMatchObject({ status: 'PERIOD_TOO_LARGE', content: null }); }
    finally { await app.close(); }
  });
  it('escapes CSV formulas, commas and quotes, and handles year rollover', () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(reportPeriod('2026-12').end).toBe('2027-01-01T00:00:00.000Z');
  });
});
