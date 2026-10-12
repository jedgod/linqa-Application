import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {WebSocket} from 'ws';
import {SignJWT} from 'jose';
import {afterEach,expect,it} from 'vitest';
import {registerCallRooms} from '../call-rooms/register.js';
import type {AppConfig} from '../config.js';
import type {Database} from '../db/pool.js';

const config={NODE_ENV:'test',JWT_HS256_SECRET:'desktop-call-auth-test-secret-only',JWT_ISSUER:'desktop-test',JWT_AUDIENCE:'desktop-test',TURN_URLS:['turn:relay.test:3478'],TURN_SHARED_SECRET:'test-only'} as AppConfig;
const sockets:WebSocket[]=[];let cleanup:(()=>Promise<void>)|undefined;
afterEach(async()=>{for(const socket of sockets.splice(0)){socket.terminate();}await cleanup?.();cleanup=undefined;});
async function setup(){
 const db={query:async(sql:string)=>({rows:sql.includes('to_regclass')?[{name:'secure_call_rooms'}]:sql.includes('device_name')?[{device_name:'Test desktop',platform:'WEB'}]:[],rowCount:1}),connect:async()=>({query:async()=>({rows:[{acquired:true}],rowCount:1}),release(){}})} as unknown as Database;
 const app=Fastify();await app.register(websocket);await registerCallRooms(app,config,db);await app.listen({port:0,host:'127.0.0.1'});cleanup=()=>app.close();
 return `ws://127.0.0.1:${(app.server.address() as {port:number}).port}/v1/call-rooms/signaling`;
}
async function token(scope='calls:write'){
 return new SignJWT({user_id:'11111111-1111-4111-8111-111111111111',device_id:'22222222-2222-4222-8222-222222222222',scope}).setProtectedHeader({alg:'HS256'}).setSubject('test-user').setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('2m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
}
it('authenticates browser frames and acknowledges device requests without putting tokens in URLs',async()=>{
 const url=await setup();const jwt=await token();const socket=new WebSocket(url);sockets.push(socket);
 const ready=new Promise<any>((resolve,reject)=>{socket.once('message',raw=>resolve(JSON.parse(raw.toString())));socket.once('error',reject);});
 socket.once('open',()=>socket.send(JSON.stringify({event:'authenticate',token:jwt})));expect(await ready).toEqual({event:'ready',data:{}});
 const ack=new Promise<any>(resolve=>socket.once('message',raw=>resolve(JSON.parse(raw.toString()))));socket.send(JSON.stringify({id:1,event:'call:devices',data:{}}));
 const result=await ack;expect(result.id).toBe(1);expect(result.ok).toBe(true);expect(url).not.toContain(jwt);
});
it('rejects missing scope in a browser authentication frame',async()=>{
 const url=await setup();const jwt=await token('calls:read');const socket=new WebSocket(url);sockets.push(socket);
 const closed=new Promise<number>(resolve=>socket.once('close',code=>resolve(code)));socket.once('open',()=>socket.send(JSON.stringify({event:'authenticate',token:jwt})));
 expect(await closed).toBe(4003);
});
it('rejects an unauthenticated call command',async()=>{
 const socket=new WebSocket(await setup());sockets.push(socket);const closed=new Promise<number>(resolve=>socket.once('close',code=>resolve(code)));
 socket.once('open',()=>socket.send(JSON.stringify({id:1,event:'call:devices',data:{}})));expect(await closed).toBe(4003);
});
