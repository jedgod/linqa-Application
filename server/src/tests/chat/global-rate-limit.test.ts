import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {SignJWT} from 'jose';
import {expect,it} from 'vitest';
import {authenticatedRateLimitKey} from '../../auth/rate-limit-key.js';
import type {AppConfig} from '../../config.js';
const config={JWT_ISSUER:'https://rate.test',JWT_AUDIENCE:'linqa',JWT_HS256_SECRET:'rate-limit-fixture-secret-at-least-32-characters'} as AppConfig;
async function token(user:string,device?:string,secret=config.JWT_HS256_SECRET){return new SignJWT({user_id:user,device_id:device,scope:'messages:read'}).setProtectedHeader({alg:'HS256'}).setSubject(user).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(secret));}
async function fixture(active=true){const app=Fastify();await app.register(rateLimit,{max:2,timeWindow:60000,keyGenerator:authenticatedRateLimitKey(config,{query:async()=>({rows:[],rowCount:active?1:0})})});app.get('/probe',async()=>({ok:true}));return app;}
it('separates authenticated accounts behind the same network while combining their own devices',async()=>{const app=await fixture();try{const a=await token('alice','phone'),linked=await token('alice','browser'),b=await token('bob','phone-2');for(const value of [a,linked])expect((await app.inject({url:'/probe',headers:{authorization:'Bearer '+value}})).statusCode).toBe(200);expect((await app.inject({url:'/probe',headers:{authorization:'Bearer '+a}})).statusCode).toBe(429);expect((await app.inject({url:'/probe',headers:{authorization:'Bearer '+b}})).statusCode).toBe(200);}finally{await app.close();}});
it.skipIf(!process.env.DATABASE_URL)('the real application returns a coded 429 rather than an internal error',async()=>{
 const {buildApp}=await import('../../app.js');const {loadConfig}=await import('../../config.js');
 const {createPool}=await import('../../db/pool.js');const settings={...loadConfig(),LOG_LEVEL:'fatal' as const,GLOBAL_RATE_LIMIT_PER_MINUTE:30};const db=createPool(settings);const app=await buildApp(settings,db);
 try {for(let i=0;i<30;i++)expect((await app.inject({url:'/health/live'})).statusCode).toBe(200);const limited=await app.inject({url:'/health/live'});expect(limited.statusCode).toBe(429);expect(limited.json().error).toBe('RATE_LIMITED');expect(limited.headers['retry-after']).toBeTruthy();}finally{await app.close();await db.end();}
});
it('forged identities cannot create unlimited rate-limit buckets',async()=>{const app=await fixture();try{for(let i=0;i<3;i++){const forged=await token('forged-'+i,undefined,'incorrect-fixture-secret-at-least-32-characters');expect((await app.inject({url:'/probe',headers:{authorization:'Bearer '+forged}})).statusCode).toBe(i<2?200:429);}}finally{await app.close();}});
it('a revoked token cannot consume the active account budget',async()=>{const app=await fixture(false);try{const revoked=await token('alice','old-device'),active=await token('alice');for(let i=0;i<3;i++)await app.inject({url:'/probe',headers:{authorization:'Bearer '+revoked}});expect((await app.inject({url:'/probe',headers:{authorization:'Bearer '+active}})).statusCode).toBe(200);}finally{await app.close();}});
