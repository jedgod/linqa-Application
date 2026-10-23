import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerModulesRoutes } from '../routes/modules.routes.js';
import { registerPrivacyRoutes } from '../routes/privacy.js';
import type { AppConfig } from '../config.js';
import type { ModulesService } from '../services/modules.service.js';
import type { PrivacySettingsService } from '../services/privacy-settings.service.js';

const user = '00000000-0000-4000-8000-000000000001';
const note = '00000000-0000-4000-8000-0000000000a1';
const org = '00000000-0000-4000-8000-0000000000b1';
const config = { JWT_ISSUER: 'modules-tests', JWT_AUDIENCE: 'linqa-api', JWT_HS256_SECRET: 'modules-test-secret-at-least-32-characters' } as AppConfig;
const sealedOk = 'A'.repeat(40);

describe('encrypted notes, calendar and read-only enterprise routes', () => {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string, result: unknown) => vi.fn(async (...args: unknown[]) => { calls.push([name, args]); if (result instanceof Error) throw result; return result; });
  const service = {
    listNotes: record('listNotes', [{ id: note, noteType: 'NOTE', ciphertextBase64: sealedOk, createdAt: 'x', updatedAt: 'y' }]),
    replaceNote: vi.fn(async (_u: string, id: string) => (id === note ? { id, noteType: 'NOTE', ciphertextBase64: sealedOk, createdAt: 'x', updatedAt: 'z' } : null)),
    deleteNote: vi.fn(async (_u: string, id: string) => id === note),
    listEvents: record('listEvents', []),
    updateEvent: vi.fn(async (_u: string, _id: string, patch: { startsAt?: Date }) => { if (patch.startsAt && patch.startsAt.getUTCFullYear() === 2000) throw new Error('INVALID_EVENT_TIME'); return { id: 'e' }; }),
    deleteEvent: vi.fn(async () => false),
    organizations: record('organizations', []),
    organization: vi.fn(async (o: string) => { if (o !== org) throw new Error('ORGANIZATION_NOT_FOUND'); return { id: o }; }),
    directory: record('directory', []),
    policies: record('policies', []),
    auditLog: vi.fn(async () => { throw new Error('ADMIN_REQUIRED'); })
  } as unknown as ModulesService;
  const privacy = { get: vi.fn(async () => ({ readReceipts: true })), update: vi.fn(async () => undefined) } as unknown as PrivacySettingsService;
  const app = Fastify();
  const token = async (scope: string) => new SignJWT({ user_id: user, scope }).setSubject(user).setProtectedHeader({ alg: 'HS256' }).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  const as = async (scope: string) => ({ authorization: `Bearer ${await token(scope)}` });

  beforeAll(async () => { await registerModulesRoutes(app, config, service); await registerPrivacyRoutes(app, config, privacy); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('rejects unauthenticated requests and the wrong scope before touching data', async () => {
    expect((await app.inject({ url: '/v2/notes' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v2/notes', headers: await as('calendar:read') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: `/v2/notes/${note}`, headers: await as('notes:read'), payload: { ciphertextBase64: sealedOk } })).statusCode).toBe(401);
    expect(service.listNotes).not.toHaveBeenCalled();
  });

  it('lists the signed-in user\'s notes as ciphertext, never cached', async () => {
    const res = await app.inject({ url: '/v2/notes', headers: await as('notes:read') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().items[0]).toMatchObject({ id: note, ciphertextBase64: sealedOk });
    expect(calls.find((c) => c[0] === 'listNotes')![1]).toEqual([user]);
  });

  it('replaces and deletes only an existing note, and validates what it is given', async () => {
    const h = await as('notes:write');
    expect((await app.inject({ method: 'PUT', url: `/v2/notes/${note}`, headers: h, payload: { ciphertextBase64: sealedOk } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/v2/notes/00000000-0000-4000-8000-0000000000ff', headers: h, payload: { ciphertextBase64: sealedOk } })).json()).toEqual({ error: 'NOTE_NOT_FOUND' });
    for (const payload of [{ ciphertextBase64: 'short' }, { ciphertextBase64: 'not base64 !!!!!!!!!!!!!!!!!!!!!!' }, { ciphertextBase64: sealedOk, title: 'plain' }, {}]) {
      expect((await app.inject({ method: 'PUT', url: `/v2/notes/${note}`, headers: h, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'PUT', url: '/v2/notes/not-a-uuid', headers: h, payload: { ciphertextBase64: sealedOk } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/v2/notes/${note}`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/v2/notes/00000000-0000-4000-8000-0000000000ff', headers: h })).statusCode).toBe(404);
  });

  it('passes a calendar window through, and maps an impossible event time to a 400', async () => {
    const read = await as('calendar:read');
    expect((await app.inject({ url: '/v2/calendar/events?from=2026-06-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z', headers: read })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v2/calendar/events?from=tomorrow', headers: read })).statusCode).toBe(400);
    const write = await as('calendar:write');
    const put = (payload: object) => app.inject({ method: 'PUT', url: `/v2/calendar/events/${note}`, headers: write, payload });
    expect((await put({ startsAt: '2000-01-01T00:00:00.000Z' })).json()).toEqual({ error: 'INVALID_EVENT_TIME' });
    expect((await put({})).statusCode).toBe(400);
    expect((await put({ title: 'plain text title' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/v2/calendar/events/${note}`, headers: write })).json()).toEqual({ error: 'EVENT_NOT_FOUND' });
  });

  it('enterprise views are read-only and report a missing or forbidden organization without detail', async () => {
    const h = await as('enterprise:read');
    expect((await app.inject({ url: '/v2/enterprise/organizations', headers: h })).statusCode).toBe(200);
    expect((await app.inject({ url: `/v2/enterprise/organizations/${org}`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v2/enterprise/organizations/00000000-0000-4000-8000-0000000000ff', headers: h })).json()).toEqual({ error: 'ORGANIZATION_NOT_FOUND' });
    const audit = await app.inject({ url: `/v2/enterprise/organizations/${org}/audit-log`, headers: h });
    expect(audit.statusCode).toBe(403);
    expect(audit.json()).toEqual({ error: 'ADMIN_REQUIRED' });
    expect((await app.inject({ method: 'PUT', url: `/v2/enterprise/organizations/${org}/policies/x`, headers: h, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ url: '/v2/enterprise/organizations', headers: await as('notes:read') })).statusCode).toBe(401);
  });

  it('does not leak internal failures', async () => {
    (service.listNotes as any).mockImplementationOnce(async () => { throw new Error('connection to server at 10.1.2.3 failed: password authentication failed'); });
    const res = await app.inject({ url: '/v2/notes', headers: await as('notes:read') });
    expect(res.statusCode).toBe(503);
    expect(res.payload).not.toContain('10.1.2.3');
  });

  it('reads privacy settings with privacy:read and writes with privacy:write', async () => {
    expect((await app.inject({ url: '/v1/privacy/settings', headers: await as('privacy:read') })).json()).toEqual({ readReceipts: true });
    expect((await app.inject({ url: '/v1/privacy/settings', headers: await as('notes:read') })).statusCode).toBe(400);
    const body = { profileVisibility: 'CONTACTS', phoneDiscoverability: true, emailDiscoverability: true, usernameDiscoverability: true, readReceipts: false, typingIndicators: true, lastSeenVisibility: 'NOBODY' };
    expect((await app.inject({ method: 'PUT', url: '/v1/privacy/settings', headers: await as('privacy:write'), payload: body })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: '/v1/privacy/settings', headers: await as('profile:write'), payload: body })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: '/v1/privacy/settings', headers: await as('privacy:read'), payload: body })).statusCode).toBe(400);
  });
});
