// @ts-nocheck -- Loads the production Rust/WASM artifact with Node fixture I/O.
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import initializeWasm from '../../../../public/linqa-core/linqa_core.js';
import {RawWasmCoreBridge} from '../../../core/RawWasmCoreBridge';
import {LinqaCallCrypto} from './LinqaCallCrypto';
import {b64d} from './bytes';
async function world(){
 const userA=crypto.randomUUID(),userB=crypto.randomUUID();const deviceA=crypto.randomUUID(),deviceB=crypto.randomUUID();
 const data=readFileSync(resolve(process.cwd(),'public/linqa-core/linqa_core_bg.wasm'));const moduleBytes=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
 const a=await RawWasmCoreBridge.load({userId:userA,deviceId:deviceA,wasmInitializer:initializeWasm,moduleBytes});
 const b=await RawWasmCoreBridge.load({userId:userB,deviceId:deviceB,wasmInitializer:initializeWasm,moduleBytes});
 const entries=[];
 for(const [core,userId,deviceId] of [[a,userA,deviceA],[b,userB,deviceB]]){const encoded=await core.publishableKeyPackage(userId,deviceId);const p=JSON.parse(new TextDecoder().decode(b64d(encoded.packageBase64)));await core.verifyKeyPackage(p);entries.push({userId,deviceId,x25519:Uint8Array.from(p.encryption_public_key),mlkem768:Uint8Array.from(p.pq_encryption_public_key),ed25519:Uint8Array.from(p.signing_public_key)});}
 const directory={devices:async userId=>entries.filter(e=>e.userId===userId),device:async(u,d)=>entries.find(e=>e.userId===u&&e.deviceId===d)??null};
 const binding=core=>({seal:(r,p,a)=>core.sealCallKey(r.x25519,r.mlkem768,p,a),open:(s,a)=>core.openCallKey(s,a),sign:m=>core.signCallMessage(m)});
 const ca=new LinqaCallCrypto(binding(a),directory,{userId:userA,deviceId:deviceA});const cb=new LinqaCallCrypto(binding(b),directory,{userId:userB,deviceId:deviceB});
 return{a,b,ca,cb,userA,userB,deviceA,deviceB,dispose:()=>{a.dispose();b.dispose();}};
}
describe('production Rust/WASM call binding',()=>{
 it('hybrid seals the call key, verifies the sender, rejects replay, and agrees on verification code',async()=>{
  const w=await world();try{const id=await w.ca.createCallKey();const [env]=await w.ca.envelopesFor(id,[w.userB]);await w.cb.acceptEnvelope(id,w.userA,w.deviceA,env.envelope);
   expect(await w.cb.verificationCode(id)).toBe(await w.ca.verificationCode(id));
   const ciphertext=await w.ca.encrypt(id,new TextEncoder().encode('signed private SDP'));
   const opened=await w.cb.decrypt(id,ciphertext);expect(new TextDecoder().decode(opened.plaintext)).toBe('signed private SDP');expect(opened.senderDeviceId).toBe(w.deviceA);
   await expect(w.cb.decrypt(id,ciphertext)).rejects.toThrow();await w.cb.forget(id);expect(w.cb.hasKey(id)).toBe(false);
  }finally{w.dispose();}
 });
 it('rejects forged sender/recipient context and unrelated Rust signing requests',async()=>{
  const w=await world();try{const id=await w.ca.createCallKey();const [env]=await w.ca.envelopesFor(id,[w.userB]);
   await expect(w.cb.acceptEnvelope(id,w.userB,w.deviceB,env.envelope)).rejects.toThrow();
   await expect(w.ca.acceptEnvelope(id,w.userA,w.deviceA,env.envelope)).rejects.toThrow();
   await expect(w.a.signCallMessage(new TextEncoder().encode('unrelated login request'))).rejects.toThrow();
  }finally{w.dispose();}
 });
});
