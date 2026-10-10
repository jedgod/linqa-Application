import {createHash} from 'node:crypto';
export const MAX_BYTES=26*1024*1024;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export class MediaError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
export function validate(scope,input){
 if(!scope.accountId||!scope.deviceId||!scope.chatId)throw new MediaError('AUTH_REQUIRED',401);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.uploadId))throw new MediaError('INVALID_UPLOAD_ID',400);
 if(!Buffer.isBuffer(input.bytes)||input.bytes.length<28||input.bytes.length>MAX_BYTES)throw new MediaError('INVALID_SIZE',413);
 if(!/^[a-f0-9]{64}$/.test(input.digest)||sha256(input.bytes)!==input.digest)throw new MediaError('DIGEST_MISMATCH',400);
}
const matches=(a,s,i)=>a.accountId===s.accountId&&a.deviceId===s.deviceId&&a.chatId===s.chatId&&a.digest===i.digest&&Number(a.byteLength)===i.bytes.length;
export class MediaService {
 constructor({repository,blobs,authorize}){Object.assign(this,{repository,blobs,authorize});}
 async upload(scope,input){
  validate(scope,input);await this.authorize(scope,'send');
  const existing=await this.repository.get(input.uploadId);
  if(existing){if(!matches(existing,scope,input))throw new MediaError('UPLOAD_CONFLICT',409);return existing;}
  await this.blobs.putImmutable(input.uploadId,input.bytes,input.digest);
  const record={uploadId:input.uploadId,...scope,digest:input.digest,byteLength:input.bytes.length};
  const stored=await this.repository.insertReady(record);
  if(!matches(stored,scope,input))throw new MediaError('UPLOAD_CONFLICT',409);
  return stored;
 }
 async download(scope,uploadId){
  await this.authorize(scope,'read');
  const record=await this.repository.get(uploadId);
  if(!record||record.chatId!==scope.chatId)throw new MediaError('NOT_FOUND',404);
  const bytes=await this.blobs.read(record.uploadId);
  if(bytes.length!==Number(record.byteLength)||sha256(bytes)!==record.digest)throw new MediaError('STORAGE_CORRUPT',503);
  return {record,bytes};
 }
}
