import type {SQLiteDatabase} from 'expo-sqlite';
import {SqliteMediaQueue,type Scope} from './sqlite-queue';
import {mediaTransport} from './transport';
import {MediaPipeline} from './media-pipeline.mjs';
import type {MediaDraft} from './ChatComposer';
export interface AttachmentCrypto {
 encryptFile(scope:Scope,draft:MediaDraft):Promise<{uri:string;digest:string;byteLength:number;recipientDescriptor:unknown}>;
 sealLocal(scope:Scope,text:string):Promise<string>;
 openLocal(scope:Scope,sealed:string):Promise<string>;
 decryptFile(scope:Scope,bytes:Uint8Array,payload:unknown):Promise<string>;
}
export interface Connections {
 db:SQLiteDatabase; scope:Scope; apiBase:string;
 crypto:AttachmentCrypto;
 files:{readEncrypted(uri:string):Promise<Uint8Array>;removeEncrypted(uri:string):Promise<void>};
 authHeaders(scope:Scope):Promise<Record<string,string>>;
 // Resolve native binding independently of route-provided scope.
 boundDeviceId(accountId:string):Promise<string>;
 ensureMessageQueued(scope:Scope,payload:unknown,messageId:string):Promise<boolean>;
 newId():string;
 assertLive(scope:Scope):void;
}
const queueSchema=`CREATE TABLE IF NOT EXISTS chat_media_uploads_v1 (
 upload_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, device_id TEXT NOT NULL,
 chat_id TEXT NOT NULL, message_id TEXT NOT NULL, encrypted_uri TEXT NOT NULL,
 local_sealed_descriptor TEXT NOT NULL,digest TEXT NOT NULL,byte_length INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','UPLOADED','MESSAGE_QUEUED','FAILED')),
 UNIQUE(account_id,device_id,chat_id,message_id));
 CREATE INDEX IF NOT EXISTS chat_media_queue_scope ON chat_media_uploads_v1(account_id,device_id,chat_id,status);`;
export async function connectChatMedia(c:Connections) {
 const {scope}=c;
 for(const key of ['accountId','deviceId','chatId'] as const)if(!scope[key]?.trim())throw new Error('MEDIA_SCOPE_REQUIRED');
 c.assertLive(scope);
 if(await c.boundDeviceId(scope.accountId)!==scope.deviceId)throw new Error('DEVICE_SCOPE_MISMATCH');
 c.assertLive(scope);
 // Integrate this schema with the existing app migration manager before release.
 // SQLite holds ciphertext paths and locally encrypted descriptors, not raw keys.
 await c.db.execAsync(queueSchema);c.assertLive(scope);
 const queue=new SqliteMediaQueue(c.db);
 const transport=mediaTransport(c.apiBase,c.authHeaders);
 const pipeline=new MediaPipeline({queue,crypto:c.crypto,files:c.files,transport,
  sendPayload:c.ensureMessageQueued,newId:c.newId,assertLive:c.assertLive});
 return {
  scope,queue,pipeline,
  send:(draft:MediaDraft,caption:string)=>pipeline.prepare(scope,draft,caption),
  async retry(uploadId:string){c.assertLive(scope);return pipeline.resume(scope,uploadId);},
  async flush(){c.assertLive(scope);for(const job of await queue.list(scope)){c.assertLive(scope);await pipeline.resume(scope,job.uploadId);}},
  async failed(){c.assertLive(scope);const rows=await c.db.getAllAsync<{upload_id:string}>("SELECT upload_id FROM chat_media_uploads_v1 WHERE account_id=? AND device_id=? AND chat_id=? AND status='FAILED'",scope.accountId,scope.deviceId,scope.chatId);return rows;},
  async discard(uploadId:string){
   c.assertLive(scope);if(pipeline.active.has(uploadId))throw new Error('MEDIA_IN_FLIGHT');
   const job=await queue.get(scope,uploadId);c.assertLive(scope);if(!job)return;
   // Only permanent failures can be discarded here. An uncertain send may have
   // already queued a message; coordinate that through existing message outbox.
   if(job.status!=='FAILED')throw new Error('USE_EXISTING_OUTBOX_DISCARD');
   await c.files.removeEncrypted(job.encryptedUri);c.assertLive(scope);await queue.discard(scope,uploadId);
  }
 };
}
