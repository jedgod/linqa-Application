import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { registerSearchRoutes } from '../routes/search.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';

const config = { JWT_ISSUER: 'search-test', JWT_AUDIENCE: 'search-test', JWT_HS256_SECRET: 'search-test-secret-at-least-32-characters' } as AppConfig;
const userId = '11111111-1111-4111-8111-111111111111';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function fixture(rows: unknown[] = [], scope = 'messages:read', revoked = false) {
  const app = Fastify(); apps.push(app);
  const query = vi.fn(async (sql: string, _params: unknown[]) => sql.includes('FROM devices') ? { rows: [], rowCount: revoked ? 0 : 1 } : { rows, rowCount: rows.length });
  await registerSearchRoutes(app, config, { query } as unknown as Database);
  const token = await new SignJWT({ user_id: userId, device_id: 'device-test', scope }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return { app, query, headers: { authorization: `Bearer ${token}` } };
}
describe('Authenticated Linqa search', () => {
  it('refuses anonymous, insufficient-scope and revoked-device searches before reading results', async () => {
    const anon = await fixture();
    expect((await anon.app.inject({ url: '/v1/search?q=Jane' })).statusCode).toBe(401);
    expect(anon.query).not.toHaveBeenCalled();
    const scoped = await fixture([], 'profile:read');
    expect((await scoped.app.inject({ url: '/v1/search?q=Jane', headers: scoped.headers })).statusCode).toBe(401);
    expect(scoped.query).not.toHaveBeenCalled();
    const revoked = await fixture([], 'messages:read', true);
    expect((await revoked.app.inject({ url: '/v1/search?q=Jane', headers: revoked.headers })).statusCode).toBe(401);
    expect(revoked.query).toHaveBeenCalledTimes(1);
  });
  it.each(['q=x', 'q=' + 'x'.repeat(101), 'q=Jane&limit=500', 'q=Jane&offset=-1', 'q=Jane&kind=invalid'])('rejects invalid bounds: %s', async query => {
    const f = await fixture();
    expect((await f.app.inject({ url: '/v1/search?' + query, headers: f.headers })).statusCode).toBe(422);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('binds the search text and caller identity, and excludes removed or blocked people', async () => {
    const f = await fixture(); const text = "Jane' OR true --";
    const response = await f.app.inject({ url: '/v1/search?q=' + encodeURIComponent(text), headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const searches = f.query.mock.calls.slice(1);
    expect(searches).toHaveLength(2);
    for (const [sql, params] of searches) {
      expect(params).toEqual([userId, text, 21, 0]);
      expect(sql).not.toContain(text);
      expect(sql).toContain('removed_at IS NULL');
      expect(sql).toContain('blocked_users');
    }
    expect(searches[0]?.[0]).toContain('cm.user_id=$1');
    expect(searches[1]?.[0]).toContain('cc.owner_user_id=$1');
  });
  it('paginates bounded results and runs only the requested category', async () => {
    const f = await fixture([{ title: 'Jane 1' }, { title: 'Jane 2' }, { title: 'Jane 3' }]);
    const response = await f.app.inject({ url: '/v1/search?q=Jane&kind=chats&limit=2&offset=2', headers: f.headers });
    expect(response.json().chats).toHaveLength(2);
    expect(response.json().people).toEqual([]);
    expect(response.json().nextOffset).toBe(4);
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(f.query.mock.calls[1]?.[1]).toEqual([userId, 'Jane', 3, 2]);
  });
  it('shows a retryable error when the database fails', async () => {
    const f = await fixture();
    f.query.mockImplementation(async (sql: string) => { if (sql.includes('FROM devices')) return { rows: [], rowCount: 1 }; throw new Error('DB unavailable'); });
    expect((await f.app.inject({ url: '/v1/search?q=Jane', headers: f.headers })).statusCode).toBe(503);
  });
});
