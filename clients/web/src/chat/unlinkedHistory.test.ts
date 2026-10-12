// @ts-nocheck -- Runs the actual phone messaging service against the Rust/WASM bridge.
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {RawWasmCoreBridge} from '../core/RawWasmCoreBridge';
import initializeWasm from '../../public/linqa-core/linqa_core.js';
import {SecureMessaging,base64ToBytes,bytesToBase64} from './secureMessaging';
import {SecureCoreMessaging} from '../../../mobile/services/secure-core';

it('both phone and browser reopen accepted polls and votes after unlink, without trusting new messages or sending to the revoked device',async()=>{
 const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',conversation='99999999-9999-4999-8999-999999999999';
 const ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
 const bytes=readFileSync(resolve('public/linqa-core/linqa_core_bg.wasm'));const cores=[];
 try{
  for(let i=0;i<3;i++)cores.push(await RawWasmCoreBridge.load({userId:i===1?bob:alice,deviceId:ids[i],wasmInitializer:initializeWasm,moduleBytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}));
  const packages=await Promise.all(cores.map((core,i)=>core.publishableKeyPackage(i===1?bob:alice,ids[i])));let revoked=false;const accepted=new Map();
  const directory={keyPackages:async(user)=>ids.flatMap((deviceId,i)=>((i===1?bob:alice)===user&&!(i===2&&revoked))?[{deviceId,packageBase64:packages[i].packageBase64}]:[]),historicalSenderKey:async context=>{
   const saved=accepted.get(context.messageId);if(context.conversationId!==conversation||context.senderUserId!==alice||context.senderDeviceId!==ids[2]||saved!==context.ciphertextBase64)throw Error('Historical ciphertext not accepted');
   return JSON.parse(new TextDecoder().decode(base64ToBytes(packages[2].packageBase64))).signing_public_key;
  }};
  const members=async()=>[alice,bob];const browser=new SecureMessaging({core:cores[2],directory,deviceId:()=>ids[2],members});
  const bridge={verifyKeyPackage:async b=>{await cores[0].verifyKeyPackage(JSON.parse(new TextDecoder().decode(base64ToBytes(b))));return true;},decryptMessage:async b=>bytesToBase64(await cores[0].decryptRaw(JSON.parse(new TextDecoder().decode(base64ToBytes(b)))))};
  const phone=new SecureCoreMessaging({bridge,device:{ensure:async()=>{},deviceId:async()=>ids[0]},directory,members});const other=new SecureMessaging({core:cores[1],directory,deviceId:()=>ids[1],members});
  const payloads=[JSON.stringify({type:'decision',title:'Pick a day',options:['Monday','Tuesday']}),JSON.stringify({type:'vote',decisionId:'poll',optionId:'Monday'})];
  for(let i=0;i<payloads.length;i++){const bundle=await browser.seal(payloads[i],{conversationId:conversation,senderUserId:alice,clientMessageId:'old-'+i});accepted.set('old-'+i,bundle);}
  revoked=true;
  for(let i=0;i<payloads.length;i++){const context={conversationId:conversation,senderUserId:alice,messageId:'old-'+i};expect(await phone.open(accepted.get(context.messageId),context)).toBe(payloads[i]);expect(await other.open(accepted.get(context.messageId),context)).toBe(payloads[i]);}
  await expect(browser.seal('new after unlink',{conversationId:conversation,senderUserId:alice,clientMessageId:'new'})).rejects.toThrow('OWN_DEVICE_NOT_PUBLISHED');
  await expect(phone.open(accepted.get('old-0'),{conversationId:conversation,senderUserId:alice,messageId:'not-accepted'})).rejects.toThrow('not accepted');
  const sender=new SecureMessaging({core:cores[0],directory,deviceId:()=>ids[0],members});const next=await sender.seal('new from phone',{conversationId:conversation,senderUserId:alice,clientMessageId:'phone-new'});const bundle=JSON.parse(new TextDecoder().decode(base64ToBytes(next)));expect(bundle.e[ids[2]]).toBeUndefined();
 }finally{cores.forEach(core=>core.dispose());}
});
