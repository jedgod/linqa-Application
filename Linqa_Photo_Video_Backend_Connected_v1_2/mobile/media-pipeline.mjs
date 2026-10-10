/** Bridges existing attachment crypto, private file storage, SQLite and chat send. */
export class MediaPipeline {
 constructor({queue,crypto,files,transport,sendPayload,newId,assertLive}){Object.assign(this,{queue,crypto,files,transport,sendPayload,newId,assertLive});this.active=new Set();}
 async prepare(scope,draft,caption){
  this.assertLive(scope);
  if(!scope.deviceId||!scope.accountId||!scope.chatId)throw new Error('DEVICE_SCOPE_REQUIRED');
  const uploadId=this.newId(),messageId=this.newId();
  // encryptFile must read actual bytes, enforce 25MB/60s constraints, use existing
  // audited attachment AEAD, and copy ONLY ciphertext to an app-private path.
  const encrypted=await this.crypto.encryptFile(scope,draft);
  this.assertLive(scope);
  const payload={type:'media',version:1,kind:draft.kind,uploadId,caption,mimeType:draft.mimeType,name:draft.name,byteLength:encrypted.byteLength,digest:encrypted.digest,attachment:encrypted.recipientDescriptor};
  const localSealedDescriptor=await this.crypto.sealLocal(scope,JSON.stringify(payload));
  this.assertLive(scope);
  await this.queue.put({uploadId,messageId,...scope,encryptedUri:encrypted.uri,localSealedDescriptor,digest:encrypted.digest,byteLength:encrypted.byteLength,status:'QUEUED'});
  return this.resume(scope,uploadId);
 }
 async resume(scope,uploadId){
  if(this.active.has(uploadId))return false;this.active.add(uploadId);
  try{
   this.assertLive(scope);const job=await this.queue.get(scope,uploadId);if(!job)return false;
   if(job.status==='MESSAGE_QUEUED')return true;
   if(job.status==='FAILED')return false;
   if(job.status==='QUEUED'){
    const bytes=await this.files.readEncrypted(job.encryptedUri);
    const result=await this.transport.upload(scope,{uploadId,digest:job.digest,bytes});
    if(result.digest!==job.digest||result.byteLength!==job.byteLength)throw new Error('UPLOAD_RESPONSE_MISMATCH');
    this.assertLive(scope);await this.queue.status(scope,uploadId,'UPLOADED');
   }
   const payload=JSON.parse(await this.crypto.openLocal(scope,job.localSealedDescriptor));
   this.assertLive(scope);
   // Existing service persists sealed envelope with stable message ID before
   // returning accepted=true. Retry invokes same existing outbox, never re-seals.
   const accepted=await this.sendPayload(scope,payload,job.messageId);
   this.assertLive(scope);
   if(accepted)await this.queue.status(scope,uploadId,'MESSAGE_QUEUED');
   return accepted;
  }catch(error){
   // Offline/uncertain outcomes keep bytes and IDs for foreground retry.
   if(['UPLOAD_CONFLICT','NOT_AUTHORIZED','INVALID_SIZE','DIGEST_MISMATCH'].includes(error?.code))await this.queue.status(scope,uploadId,'FAILED');
   throw error;
  }finally{this.active.delete(uploadId);}
 }
 async receive(scope,payload){
  this.assertLive(scope);
  const result=await this.transport.download(scope,payload.uploadId);
  // Verify local SHA256 and authenticated encryption before handing any URI to
  // image/video renderer; decrypt inside private temporary storage only.
  const uri=await this.crypto.decryptFile(scope,result.bytes,payload);
  this.assertLive(scope);return uri;
 }
}
