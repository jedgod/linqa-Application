import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';
import { registerCallsV2Routes } from '../calls/calls-v2.routes.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import type { CallService } from '../services/call.service.js';

const user = '00000000-0000-4000-8000-000000000001';
const device = '00000000-0000-4000-8000-000000000002';
const call = '00000000-0000-4000-8000-000000000003';
const config = { JWT_ISSUER: 'call-tests', JWT_AUDIENCE: 'linqa-api', JWT_HS256_SECRET: 'call-test-secret-at-least-32-characters' } as AppConfig;
async function fixture(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  const app = Fastify();
  await registerCallsV2Routes(app, config, { query } as unknown as Database, {} as CallService);
  const token = await new SignJWT({ user_id: user, device_id: device, scope: 'calls:read calls:write' }).setSubject(user).setProtectedHeader({ alg: 'HS256' }).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return { app, query, headers: { authorization: `Bearer ${token}` } };
}
it('new call surfaces require authentication before database access', async () => {
  const f = await fixture(); try {
    for (const request of [{ url: `/v1/calls/${call}` }, { url: '/v1/calls/incoming' }, { method: 'POST' as const, url: `/v1/calls/${call}/accept` }]) expect((await f.app.inject(request)).statusCode).toBe(401);
    expect(f.query).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('call details hide absent and unrelated calls and scope lookup to the authenticated user', async () => {
  const f = await fixture(); try {
    expect((await f.app.inject({ url: `/v1/calls/${call}`, headers: f.headers })).statusCode).toBe(404);
    expect(f.query.mock.calls[0]).toEqual([expect.stringContaining('me.user_id = $2'), [call, user]]);
  } finally { await f.app.close(); }
});
it('incoming calls are scoped to the authenticated callee device and are not cached', async () => {
  const f = await fixture(); try {
    const response = await f.app.inject({ url: '/v1/calls/incoming', headers: f.headers });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ items: [] }); expect(response.headers['cache-control']).toBe('private, no-store');
    expect(f.query.mock.calls[0]).toEqual([expect.stringContaining("me.device_id = $1 AND me.role = 'CALLEE'"), [device]]);
  } finally { await f.app.close(); }
});
it('accept refuses an already-ended call or a device outside the callee role', async () => {
  const f = await fixture(); try {
    expect((await f.app.inject({ method: 'POST', url: `/v1/calls/${call}/accept`, headers: f.headers })).statusCode).toBe(409);
    expect(f.query.mock.calls[0]).toEqual([expect.stringContaining("p.device_id = $2 AND p.role = 'CALLEE'"), [call, device]]);
  } finally { await f.app.close(); }
});
