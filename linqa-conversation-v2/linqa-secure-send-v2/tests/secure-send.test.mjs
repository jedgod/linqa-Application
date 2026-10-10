import test from 'node:test';import assert from 'node:assert/strict';
import {activateSecureSend} from '../clients/shared/secure-send.ts';
import {deviceTransport} from '../clients/shared/deviceTransport.ts';
import {durableOutbox} from '../clients/shared/durableOutbox.ts';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003';
const actor={userId:a,deviceId:'phone'};
const devices=[actor,{userId:a,deviceId:'desktop'},{userId:b,deviceId:'phone'},{userId:b,deviceId:'web'}].map(x=>({...x,keyPackage:{}}));
function fixture(overrides={}){
 const disk=new Map();const posted=[];let failed=false;let seals=0;
 const outbox=durableOutbox({insertIfAbsent:async(k,v)=>{if(!disk.has(k))disk.set(k,v);},scanPrefix:async p=>[...disk].filter(([k])=>k.startsWith(p)).map(([key,value])=>({key,value})),delete:async k=>{disk.delete(k);}});
 const protocol={assertReady:async()=>{},verifiedSnapshot:async()=>({members:[a,b],devices}),seal:async()=>{seals++;return Buffer.alloc(32,seals).toString('base64');},open:async()=> 'verified text',...overrides.protocol};
 const client=activateSecureSend({actor,protocol,outbox,uuid:()=>id,transport:{post:async(cid,batch)=>{posted.push(JSON.parse(JSON.stringify(batch)));if(failed)throw Error('offline');return {id,seq:'1'};},page:async()=>({events:[],cursor:'0',hasMore:false})},...overrides.options});
 return {client,disk,posted,outbox,get seals(){return seals;},fail(v){failed=v;}};
}
test('fanout includes sender and recipient linked devices',async()=>{const f=fixture();await f.client.send(id,'Hello 🌍');await f.client.flush();assert.equal(f.posted[0].envelopes.length,4);assert.equal(f.disk.size,0);});
test('durable queue contains no message text',async()=>{const f=fixture();await f.client.send(id,'Private phrase');assert.equal(JSON.stringify([...f.disk.values()]).includes('Private phrase'),false);assert.equal(f.posted.length,0);});
test('retry keeps exact ciphertext and ID; no additional encryption',async()=>{const f=fixture();await f.client.send(id,'Hi');f.fail(true);await assert.rejects(f.client.flush(),/offline/);assert.equal(f.disk.size,1);f.fail(false);await f.client.flush();assert.deepEqual(f.posted[0],f.posted[1]);assert.equal(f.seals,4);});
test('restored outbox can be flushed by a new activated instance',async()=>{const f=fixture();await f.client.send(id,'Hi');const reopened=fixture({options:{outbox:f.outbox}});await reopened.client.flush();assert.equal(reopened.posted.length,1);assert.equal(reopened.seals,0);assert.equal(f.disk.size,0);});
test('missing recipient keys stop sending',async()=>{const f=fixture({protocol:{verifiedSnapshot:async()=>({members:[a,b],devices:devices.filter(d=>d.userId===a)})}});await assert.rejects(f.client.send(id,'Hi'),/UNAVAILABLE/);assert.equal(f.disk.size,0);});
test('unverified key package failure stops sending',async()=>{const f=fixture({protocol:{verifiedSnapshot:async()=>{throw Error('KEY_SIGNATURE_INVALID');}}});await assert.rejects(f.client.send(id,'Hi'),/KEY_SIGNATURE/);assert.equal(f.posted.length,0);});
test('missing active sender device stops sending',async()=>{const f=fixture({protocol:{verifiedSnapshot:async()=>({members:[a,b],devices:devices.filter(d=>!(d.userId===a&&d.deviceId==='phone'))})}});await assert.rejects(f.client.send(id,'Hi'),/INACTIVE/);});
test('logout closes existing instance',async()=>{const f=fixture();f.client.close();await assert.rejects(f.client.send(id,'Hi'),/CLOSED/);await assert.rejects(f.client.flush(),/CLOSED/);});
test('native backend failure never downgrades encryption',async()=>{const f=fixture({protocol:{assertReady:async()=>{throw Error('NATIVE_CORE_UNAVAILABLE');}}});await assert.rejects(f.client.send(id,'Hi'),/UNAVAILABLE/);assert.equal(f.disk.size,0);});
test('empty and oversized messages rejected',async()=>{const f=fixture();await assert.rejects(f.client.send(id,''),/TEXT/);await assert.rejects(f.client.send(id,'x'.repeat(8001)),/TEXT/);});
test('HTTPS required',()=>assert.throws(()=>deviceTransport({baseUrl:'http://example.test',getToken:async()=>'',fetchImpl:fetch}),/HTTPS/));
test('fresh session token fetched for each request',async()=>{let n=0;const tokens=[];const t=deviceTransport({baseUrl:'https://example.test',getToken:async()=>String(++n),fetchImpl:async(url,init)=>{tokens.push(init.headers.authorization);return new Response(JSON.stringify({events:[],cursor:'0',hasMore:false}),{status:200});}});await t.page(id,'0');await t.page(id,'0');assert.deepEqual(tokens,['Bearer 1','Bearer 2']);});
test('durable store is mandatory',()=>assert.throws(()=>durableOutbox({}),/REQUIRED/));
