// Shared orchestration only. Cryptography is supplied by the existing audited
// Linqa native/browser protocol adapter, never by a plaintext fallback.
export type Actor = {userId:string;deviceId:string};
export type Device = Actor & {keyPackage:unknown};
export type Snapshot = {members:string[];devices:Device[]};
export type Context = {conversationId:string;senderId:string;senderDeviceId:string;clientId:string};
export type Envelope = {userId:string;deviceId:string;ciphertext:string};
export type Batch = {clientId:string;envelopes:Envelope[]};
export type Queued = {accountId:string;deviceId:string;conversationId:string;batch:Batch};
export interface SecureProtocol {
 assertReady():Promise<void>;
 // Verify ALL key-package signatures and account/device trust bindings.
 verifiedSnapshot(conversationId:string):Promise<Snapshot>;
 // Authenticate context and target IDs inside the native signed protocol.
 // Native adapter must protect ratchet state against concurrent/crashed sends.
 seal(text:string,context:Context,device:Device):Promise<string>;
 // Verify sender device/account/signature, AAD and replay protection BEFORE
 // returning text. Receiving device is specified by the signed-in actor.
 open(ciphertext:string,context:Omit<Context,'senderDeviceId'>,actor:Actor):Promise<string>;
}
export interface Outbox {
 // Durable put-if-absent keyed by accountId/deviceId/clientId.
 put(row:Queued):Promise<void>;
 list(accountId:string,deviceId:string):Promise<Queued[]>;
 remove(accountId:string,deviceId:string,clientId:string):Promise<void>;
}
export interface Transport {
 post(conversationId:string,batch:Batch):Promise<{id:string;seq:string}>;
 page(conversationId:string,cursor:string):Promise<{events:WireEvent[];cursor:string;hasMore:boolean}>;
}
export type WireEvent = {id:string;seq:string;client_id:string;sender_id:string;ciphertext:string;created_at:string};
export type Options = {actor:Actor;protocol:SecureProtocol;outbox:Outbox;transport:Transport;uuid:()=>string};
export function ensure(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
export function validateBatch(b:Batch){
 ensure(b && typeof b.clientId==='string' && /^[0-9a-f-]{36}$/i.test(b.clientId),'INVALID_CLIENT_ID');
 ensure(Array.isArray(b.envelopes)&&b.envelopes.length>0&&b.envelopes.length<=32,'DEVICE_LIMIT');
 const seen=new Set<string>();let size=0;
 for(const e of b.envelopes){
  ensure(typeof e.userId==='string'&&e.userId.length>0&&typeof e.deviceId==='string'&&e.deviceId.length>0,'INVALID_DEVICE');
  const k=JSON.stringify([e.userId,e.deviceId]);ensure(!seen.has(k),'DUPLICATE_DEVICE');seen.add(k);
  ensure(typeof e.ciphertext==='string'&&e.ciphertext.length>=16&&e.ciphertext.length<=131072&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e.ciphertext),'INVALID_CIPHERTEXT');size+=e.ciphertext.length;
 }
 ensure(size<=1048576,'BATCH_TOO_LARGE');
}
export function activateSecureSend(options:Options){
 const {actor,protocol,outbox,transport,uuid}=options;
 ensure(actor?.userId&&actor?.deviceId,'SESSION_REQUIRED');
 ensure(protocol?.assertReady&&protocol?.verifiedSnapshot&&protocol?.seal&&protocol?.open&&outbox?.put&&outbox?.list&&outbox?.remove&&transport?.post&&transport?.page&&uuid,'ADAPTERS_REQUIRED');
 let stopped=false;let queue:Promise<unknown>=Promise.resolve();
 function serial<T>(fn:()=>Promise<T>):Promise<T>{const p=queue.then(fn);queue=p.catch(()=>{});return p;}
 async function ready(){ensure(!stopped,'SESSION_CLOSED');await protocol.assertReady();ensure(!stopped,'SESSION_CLOSED');}
 return {
  async send(conversationId:string,text:string){return serial(async()=>{
   await ready();ensure(typeof text==='string'&&!!text.trim()&&text.length<=8000,'INVALID_TEXT');
   const snapshot=await protocol.verifiedSnapshot(conversationId);
   ensure(snapshot.members.length===2&&new Set(snapshot.members).size===2&&snapshot.members.includes(actor.userId),'MEMBERSHIP_REQUIRED');
   ensure(snapshot.devices.length<=32&&snapshot.devices.every(d=>snapshot.members.includes(d.userId))&&snapshot.members.every(u=>snapshot.devices.some(d=>d.userId===u)),'RECIPIENT_DEVICE_UNAVAILABLE');
   ensure(snapshot.devices.some(d=>d.userId===actor.userId&&d.deviceId===actor.deviceId),'DEVICE_INACTIVE');
   const clientId=uuid();const context={conversationId,senderId:actor.userId,senderDeviceId:actor.deviceId,clientId};
   const envelopes:Envelope[]=[];
   for(const device of snapshot.devices){await ready();envelopes.push({userId:device.userId,deviceId:device.deviceId,ciphertext:await protocol.seal(text,context,device)});}
   const batch={clientId,envelopes};validateBatch(batch);await ready();
   // Store exact encrypted bytes BEFORE network activity. Retry never creates
   // a second encryption operation or changes the message ID.
   await outbox.put({accountId:actor.userId,deviceId:actor.deviceId,conversationId,batch});
   return {clientId,state:'queued' as const};
  });},
  async flush(){return serial(async()=>{
   await ready();const result:{clientId:string;state:string}[]=[];
   for(const row of await outbox.list(actor.userId,actor.deviceId)){
    await ready();ensure(row.accountId===actor.userId&&row.deviceId===actor.deviceId,'OUTBOX_ACCOUNT_MISMATCH');validateBatch(row.batch);
    try{
     await transport.post(row.conversationId,row.batch);await ready();
     await outbox.remove(actor.userId,actor.deviceId,row.batch.clientId);
     result.push({clientId:row.batch.clientId,state:'relay_accepted'});
    }catch(e){
     // Retain exact batch for network failures; policy/device errors require
     // an explicit rekey/revocation resolution, never silently drop targets.
     throw Object.assign(e instanceof Error?e:Error('SEND_FAILED'),{clientId:row.batch.clientId});
    }
   }return result;
  });},
  async read(conversationId:string,cursor='0'){
   await ready();const page=await transport.page(conversationId,cursor);const events=[];
   for(const row of page.events){await ready();const text=await protocol.open(row.ciphertext,{conversationId,senderId:row.sender_id,clientId:row.client_id},actor);events.push({...row,text});}
   return {...page,events};
  },
  // On logout/account switch stop wake-ups first, then close this instance.
  close(){stopped=true;}
 };
}
