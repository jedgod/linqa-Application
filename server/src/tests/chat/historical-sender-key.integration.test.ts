import {ThreadAttachmentService} from "../../chat/thread-attachment.service.js";
import {assertChatSchemaReady} from '../../db/chat-schema-readiness.js';
import {registerThreadAttachmentRoutes} from "../../chat/thread-attachment.routes.js";
import {registerChatFeatureRoutes} from "../../chat/chat-feature.routes.js";
import {registerLiveScreenRoutes} from "../../chat/live-screen.routes.js";
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import {SignJWT} from 'jose';
import {ensureTestDatabase} from '../support/test-database.js';
import {loadConfig} from '../../config.js';
import {registerKeyPackageRoutes} from '../../routes/key-packages.js';
import {registerChatV2Routes} from '../../chat/chat-v2.routes.js';
import {registerChatRoutes} from '../../routes/chats.js';
import {RealtimeHub} from '../../realtime/hub.js';
import {sendMessage} from '../../chat/chat.service.js';
import type {Database} from '../../db/pool.js';

const database=await ensureTestDatabase();const suite=database?describe:describe.skip;
const config=loadConfig();let db:Database;let app:ReturnType<typeof Fastify>;const users:string[]=[];
beforeAll(async()=>{if(!database)return;db=new pg.Pool({connectionString:database.connectionString}) as unknown as Database;app=Fastify();await registerKeyPackageRoutes(app,config,db);await registerChatV2Routes(app,config,db,new RealtimeHub());await registerChatRoutes(app,config,db);await registerThreadAttachmentRoutes(app,config,db);await registerChatFeatureRoutes(app,config,db);await registerLiveScreenRoutes(app,config,db);await app.ready();});
afterAll(async()=>{if(!database)return;await app.close();await db.query('DELETE FROM conversations WHERE created_by_user_id=ANY($1::uuid[])',[users]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();await database.stop();});
async function fixture(){
 const user=randomUUID(),peer=randomUUID(),phone=randomUUID(),browser=randomUUID(),conversation=randomUUID(),signingKey=randomBytes(32);
 users.push(user,peer);for(const id of [user,peer])await db.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')",[id,'history-test-'+id]);
 for(const [id,platform,key] of [[phone,'ANDROID',randomBytes(32)],[browser,'WEB',signingKey]])await db.query("INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status) VALUES($1,$2,'Test',$3,$4,$5,'ACTIVE')",[id,user,platform,key,randomBytes(32)]);
 await db.query("INSERT INTO conversations(id,conversation_type,created_by_user_id) VALUES($1,'DIRECT',$2)",[conversation,user]);
 await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER')",[conversation,user,peer]);
 const ciphertext=Buffer.from('accepted opaque ciphertext').toString('base64');
 const message=await sendMessage(db,{conversationId:conversation,senderUserId:user,senderDeviceId:browser,clientMessageId:randomUUID(),kind:'TEXT',ciphertextBase64:ciphertext,mediaCount:0,replyToId:undefined});
 await db.query("INSERT INTO key_packages(user_id,device_id,package_version,package_bytes,package_hash,expires_at) VALUES($1,$2,1,$3,$4,now()+interval '1 day')",[user,browser,Buffer.from('historical-directory-fixture'),randomBytes(32)]);
 await db.query("UPDATE devices SET status='REVOKED',revoked_at=now() WHERE id=$1",[browser]);
 const token=async(device:string)=>new SignJWT({user_id:user,device_id:device,scope:'messages:read messages:send'}).setProtectedHeader({alg:'HS256'}).setSubject(user).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
 const body={senderUserId:user,senderDeviceId:browser,ciphertextBase64:ciphertext};const url=`/v1/chats/${conversation}/messages/${message.id}/sender-key`;
 const lookup=async(changes:object={})=>app.inject({method:'POST',url,headers:{authorization:'Bearer '+await token(phone)},payload:{...body,...changes}});
 return {user,peer,phone,browser,conversation,signingKey,message,body,url,lookup,token};
}
suite('historical sender verification after unlink',()=>{
 it('readiness rejects a reachable database missing the chat schema',async()=>{const client=await db.connect();try{await client.query('BEGIN');await client.query('SET LOCAL search_path TO pg_catalog');await expect(assertChatSchemaReady(client)).rejects.toMatchObject({code:'42P01'});}finally{await client.query('ROLLBACK');client.release();}await expect(assertChatSchemaReady(db)).resolves.toBeUndefined();});
 it('rejects inbox preview access with a revoked device token',async()=>{const f=await fixture();const response=await app.inject({method:'GET',url:'/v1/chats/inbox',headers:{authorization:'Bearer '+await f.token(f.browser)}});expect(response.statusCode).toBe(401);});
 it('returns only the public signing key for an accepted message after revocation',async()=>{const f=await fixture();const response=await f.lookup();expect(response.statusCode).toBe(200);expect(response.json()).toEqual({senderUserId:f.user,senderDeviceId:f.browser,signingPublicKey:Array.from(f.signingKey)});expect((await db.query('SELECT signing_public_key FROM devices WHERE id=$1',[f.browser])).rows[0].signing_public_key).toEqual(f.signingKey);const directory=await app.inject({method:'GET',url:`/v1/users/${f.user}/key-packages`,headers:{authorization:'Bearer '+await f.token(f.phone)}});expect(directory.statusCode).toBe(200);expect(directory.json().keyPackages).toEqual([]);});
 it('rejects changed ciphertext or forged sender identity',async()=>{const f=await fixture();expect((await f.lookup({ciphertextBase64:Buffer.from('new forgery').toString('base64')})).statusCode).toBe(404);expect((await f.lookup({senderDeviceId:f.phone})).statusCode).toBe(404);expect((await f.lookup({senderUserId:f.peer})).statusCode).toBe(404);});
 it('does not return a key for a message accepted after revocation',async()=>{const f=await fixture();await db.query("UPDATE devices SET revoked_at='2000-01-01' WHERE id=$1",[f.browser]);expect((await f.lookup()).statusCode).toBe(404);});
 it('honors removed membership, cleared history, deletion and expiration',async()=>{const f=await fixture();await db.query('UPDATE conversation_members SET removed_at=now() WHERE conversation_id=$1 AND user_id=$2',[f.conversation,f.user]);expect((await f.lookup()).statusCode).toBe(404);await db.query('UPDATE conversation_members SET removed_at=NULL,cleared_at=now() WHERE conversation_id=$1 AND user_id=$2',[f.conversation,f.user]);expect((await f.lookup()).statusCode).toBe(404);await db.query('UPDATE conversation_members SET cleared_at=NULL WHERE conversation_id=$1 AND user_id=$2',[f.conversation,f.user]);await db.query('UPDATE chat_messages SET deleted_at=now() WHERE id=$1',[f.message.id]);expect((await f.lookup()).statusCode).toBe(404);await db.query("UPDATE chat_messages SET deleted_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1",[f.message.id]);expect((await f.lookup()).statusCode).toBe(404);});
 it('rejects an unlinked device using its still-valid token to send or read verification keys',async()=>{const f=await fixture();const authorization='Bearer '+await f.token(f.browser);const sent=await app.inject({method:'POST',url:`/v1/chats/${f.conversation}/messages`,headers:{authorization},payload:{clientMessageId:randomUUID(),kind:'TEXT',ciphertext:f.body.ciphertextBase64}});expect(sent.statusCode).toBe(401);expect((await app.inject({method:'POST',url:f.url,headers:{authorization},payload:f.body})).statusCode).toBe(403);});
});

suite('message deletion permissions and persistence',()=>{
 async function peerAuth(f:Awaited<ReturnType<typeof fixture>>){
  const id=randomUUID();await db.query("INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status) VALUES($1,$2,'Peer','ANDROID',$3,$4,'ACTIVE')",[id,f.peer,randomBytes(32),randomBytes(32)]);
  return 'Bearer '+await new SignJWT({user_id:f.peer,device_id:id,scope:'messages:read messages:send'}).setProtectedHeader({alg:'HS256'}).setSubject(f.peer).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
 }
 const path=(f:Awaited<ReturnType<typeof fixture>>)=>`/v1/chats/${f.conversation}/messages`;
 it('delete for me persists on the account, preserves peer history, and denies historical opening',async()=>{
  const f=await fixture();const authorization='Bearer '+await f.token(f.phone),peer=await peerAuth(f);
  for(let i=0;i<2;i++)expect((await app.inject({method:'DELETE',url:path(f)+'/'+f.message.id,headers:{authorization},payload:{scope:'me'}})).statusCode).toBe(200);
  const own=await app.inject({method:'GET',url:path(f),headers:{authorization}});expect(own.json().messages).toEqual([]);
  const theirs=await app.inject({method:'GET',url:path(f),headers:{authorization:peer}});expect(theirs.json().messages.map((m:{id:string})=>m.id)).toContain(f.message.id);
  expect((await f.lookup()).statusCode).toBe(404);
  const visible=await app.inject({method:'POST',url:path(f)+'/visibility',headers:{authorization},payload:{messageIds:[f.message.id]}});expect(visible.json().visibleMessageIds).toEqual([]);
 });
 it('only the sender can delete a photo for everyone, and accepted ciphertext is removed',async()=>{
  const f=await fixture();const authorization='Bearer '+await f.token(f.phone),peer=await peerAuth(f);
  await db.query("UPDATE chat_messages SET kind='PHOTOS',media_count=1 WHERE id=$1",[f.message.id]);
  expect((await app.inject({method:'DELETE',url:path(f)+'/'+f.message.id,headers:{authorization:peer},payload:{scope:'everyone'}})).statusCode).toBe(403);
  for(let i=0;i<2;i++)expect((await app.inject({method:'DELETE',url:path(f)+'/'+f.message.id,headers:{authorization},payload:{scope:'everyone'}})).statusCode).toBe(200);
  for(const auth of [authorization,peer]){
   expect((await app.inject({method:'GET',url:path(f),headers:{authorization:auth}})).json().messages).toEqual([]);
   expect((await app.inject({method:'POST',url:path(f)+'/visibility',headers:{authorization:auth},payload:{messageIds:[f.message.id]}})).json().visibleMessageIds).toEqual([]);
  }
  const row=(await db.query('SELECT deleted_at,body_ciphertext FROM chat_messages WHERE id=$1',[f.message.id])).rows[0];expect(row.deleted_at).toBeTruthy();expect(row.body_ciphertext.length).toBe(0);expect((await f.lookup()).statusCode).toBe(404);
 });
 it('rejects revoked devices, invalid scopes and cross-conversation targets',async()=>{
  const f=await fixture();const authorization='Bearer '+await f.token(f.phone);
  expect((await app.inject({method:'DELETE',url:path(f)+'/'+f.message.id,headers:{authorization:'Bearer '+await f.token(f.browser)},payload:{scope:'everyone'}})).statusCode).toBe(401);
  expect((await app.inject({method:'DELETE',url:path(f)+'/'+f.message.id,headers:{authorization},payload:{scope:'all'}})).statusCode).toBe(422);
  expect((await app.inject({method:'DELETE',url:`/v1/chats/${randomUUID()}/messages/${f.message.id}`,headers:{authorization},payload:{scope:'me'}})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url:path(f)+'/visibility',headers:{authorization},payload:{messageIds:Array(501).fill(f.message.id)}})).statusCode).toBe(422);
  expect((await f.lookup()).statusCode).toBe(200);
 });
});

suite('attachment history, deletion and revoked-device feature access',()=>{
 async function attachment(f:Awaited<ReturnType<typeof fixture>>){const id=randomUUID(),envelope=Buffer.alloc(64,9);await db.query("INSERT INTO thread_attachments(id,conversation_id,sender_user_id,sender_device_id,kind,envelope,byte_length,created_at) SELECT $1,$2,$3,$4,'EVENT',$5,64,created_at FROM chat_messages WHERE id=$6",[id,f.conversation,f.user,f.browser,envelope,f.message.id]);return {id,envelope,url:`/v1/chats/${f.conversation}/messages/${id}`};}
 it('opens accepted old attachment senders after unlink and applies clear/delete-for-me only to this account',async()=>{
  const f=await fixture(),a=await attachment(f),headers={authorization:'Bearer '+await f.token(f.phone)},service=new ThreadAttachmentService(db);
  const lookup=()=>app.inject({method:'POST',url:a.url+'/sender-key',headers,payload:{...f.body,ciphertextBase64:a.envelope.toString('base64')}});
  expect((await lookup()).statusCode).toBe(200);expect(await service.list(f.peer,f.conversation)).toHaveLength(1);
  await db.query('UPDATE conversation_members SET cleared_at=now() WHERE conversation_id=$1 AND user_id=$2',[f.conversation,f.user]);
  expect(await service.list(f.user,f.conversation)).toEqual([]);expect(await service.list(f.peer,f.conversation)).toHaveLength(1);expect((await lookup()).statusCode).toBe(404);
  await db.query('UPDATE conversation_members SET cleared_at=NULL WHERE conversation_id=$1 AND user_id=$2',[f.conversation,f.user]);
  expect((await app.inject({method:'DELETE',url:a.url,headers,payload:{scope:'me'}})).statusCode).toBe(200);
  expect(await service.list(f.user,f.conversation)).toEqual([]);expect(await service.list(f.peer,f.conversation)).toHaveLength(1);expect((await lookup()).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url:`/v1/chats/${f.conversation}/messages/visibility`,headers,payload:{messageIds:[a.id]}})).json().visibleMessageIds).toEqual([]);
 });
 it('deletes an owned attachment for everyone without permitting deletion of another sender',async()=>{
  const f=await fixture(),a=await attachment(f),headers={authorization:'Bearer '+await f.token(f.phone)},service=new ThreadAttachmentService(db);
  await db.query('UPDATE thread_attachments SET sender_user_id=$1 WHERE id=$2',[f.peer,a.id]);
  expect((await app.inject({method:'DELETE',url:a.url,headers,payload:{scope:'everyone'}})).statusCode).toBe(403);
  await db.query('UPDATE thread_attachments SET sender_user_id=$1 WHERE id=$2',[f.user,a.id]);
  expect((await app.inject({method:'DELETE',url:a.url,headers,payload:{scope:'everyone'}})).statusCode).toBe(200);
  expect(await service.list(f.user,f.conversation)).toEqual([]);expect(await service.list(f.peer,f.conversation)).toEqual([]);expect((await db.query('SELECT envelope FROM thread_attachments WHERE id=$1',[a.id])).rows[0].envelope.length).toBe(0);
 });
 it('rejects revoked-device reads, new attachments and live-screen/AI capability access',async()=>{
  const f=await fixture(),headers={authorization:'Bearer '+await f.token(f.browser)};
  for(const suffix of ['attachments','features','screen-shares','media/'+randomUUID()])expect((await app.inject({method:'GET',url:`/v2/chats/${f.conversation}/${suffix}`,headers})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:`/v2/chats/${f.conversation}/attachments`,headers,payload:{id:randomUUID(),kind:'CONTACT',envelopeBase64:Buffer.alloc(64,1).toString('base64url')}})).statusCode).toBe(401);
  await expect(new ThreadAttachmentService(db).accept({id:randomUUID(),conversationId:f.conversation,userId:f.user,deviceId:f.browser,kind:'EVENT',envelope:Buffer.alloc(64,1)})).rejects.toMatchObject({code:'DEVICE_REQUIRED'});
 });
});
