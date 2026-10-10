import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/pool.js';
import { registerChatFeatureRoutes, readProviderResponse, validProviderImage } from '../../chat/chat-feature.routes.js';

const user = '00000000-0000-4000-8000-000000000001';
const chat = '00000000-0000-4000-8000-000000000002';
const config = { JWT_ISSUER: 'linqa-test', JWT_AUDIENCE: 'linqa-api', JWT_HS256_SECRET: 'feature-tests-secret-at-least-32-characters', TURN_URLS: [] } as unknown as AppConfig;
const png = { mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9l8AAAAASUVORK5CYII=' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture(extra: Partial<AppConfig> = {}, member = true) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes('SELECT cm.role') && member ? [{role:'MEMBER'}] : [], rowCount: sql.includes('SELECT cm.role') && member ? 1 : 0 }));
  const db = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Database;
  const app = Fastify(); await registerChatFeatureRoutes(app, {...config,...extra}, db);
  const token = await new SignJWT({user_id:user,scope:'messages:read messages:send'}).setProtectedHeader({alg:'HS256'}).setSubject(user).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return {app, query, headers:{authorization:`Bearer ${token}`}};
}
it('requires authentication and hides nonmember conversations', async () => {
  const f = await fixture({},false); try {
    expect((await f.app.inject({url:`/v2/chats/${chat}/features`})).statusCode).toBe(401);
    expect((await f.app.inject({url:`/v2/chats/${chat}/features`,headers:f.headers})).statusCode).toBe(404);
    expect(f.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  } finally {await f.app.close();}
});
it('fails closed for unconfigured providers and loopback TURN', async () => {
  const f = await fixture({TURN_URLS:['turn:localhost:3478'],TURN_SHARED_SECRET:'secret'}); try {
    expect((await f.app.inject({url:`/v2/chats/${chat}/features`,headers:f.headers})).json()).toEqual({aiImages:false,live:false});
    expect((await f.app.inject({url:`/v2/chats/${chat}/ice-servers`,headers:f.headers})).statusCode).toBe(503);
    expect((await f.app.inject({method:'POST',url:`/v2/chats/${chat}/ai-images`,headers:f.headers,payload:{prompt:'tree',style:'Photo',consent:true}})).statusCode).toBe(503);
  } finally {await f.app.close();}
});
it('issues expiring TURN credentials only to a member', async () => {
  const f = await fixture({TURN_URLS:['turn:relay.example.com:3478'],TURN_SHARED_SECRET:'test-turn-secret'}); try {
    const response = await f.app.inject({url:`/v2/chats/${chat}/ice-servers`,headers:f.headers});
    expect(response.statusCode).toBe(200); const [turn] = response.json();
    expect(turn.urls).toEqual(['turn:relay.example.com:3478']); expect(turn.credential).toBeTruthy();
    const expires = Number(turn.username.split(':')[0]); expect(expires).toBeGreaterThan(Date.now()/1000+3500); expect(expires).toBeLessThan(Date.now()/1000+3610);
  } finally {await f.app.close();}
});
it('requires explicit AI consent and rejects extra cleartext metadata', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher); const f = await fixture(); try {
    for (const payload of [{prompt:'tree',style:'Photo'}, {prompt:'tree',style:'Photo',consent:false}, {prompt:'tree',style:'Photo',consent:true,latitude:1}]) {
      expect((await f.app.inject({method:'POST',url:`/v2/chats/${chat}/ai-images`,headers:f.headers,payload})).statusCode).toBe(422);
    } expect(fetcher).not.toHaveBeenCalled();
  } finally {await f.app.close();}
});
it('calls the configured provider and validates image bytes', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({images:[png]}),{status:200})); vi.stubGlobal('fetch',fetcher);
  const f = await fixture({CHAT_AI_IMAGE_URL:'https://images.example.com/generate',CHAT_AI_IMAGE_TOKEN:'provider-secret-token'}); try {
    const request = {method:'POST' as const,url:`/v2/chats/${chat}/ai-images`,headers:f.headers,payload:{prompt:' tree ',style:'Sketch',consent:true}};
    const response = await f.app.inject(request); expect(response.statusCode).toBe(200); expect(response.json()).toEqual([png]);
    expect(fetcher.mock.calls[0]![0]).toBe('https://images.example.com/generate'); expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({prompt:'tree',style:'Sketch'});
    fetcher.mockResolvedValue(new Response(JSON.stringify({images:[{mime:'image/png',base64:Buffer.from('not an image').toString('base64')}]}),{status:200}));
    expect((await f.app.inject(request)).statusCode).toBe(502);
  } finally {await f.app.close();}
});
it('bounds provider responses and rejects bad encodings and signatures', async () => {
  await expect(readProviderResponse(new Response('123456789'),4)).rejects.toThrow('IMAGE_PROVIDER_FAILED');
  await expect(readProviderResponse(new Response('unavailable',{status:503}))).rejects.toThrow('IMAGE_PROVIDER_FAILED');
  expect(validProviderImage(png)).toBe(true); expect(validProviderImage({...png,mime:'image/jpeg'})).toBe(false);
  expect(validProviderImage({...png,base64:png.base64+'='})).toBe(false);
});

