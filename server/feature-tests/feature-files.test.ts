import {beforeEach,expect,it} from 'vitest';
import {files} from './feature-native-mocks';
import {createFeatureAttachments} from '../../clients/mobile/features/conversation/attachments/production-adapter';
import type {ConversationServiceLike} from '../../clients/mobile/services/conversation-types';
const chat='00000000-0000-4000-8000-000000000001';
beforeEach(()=>files.clear());
function fixture(){
  let live=true;const blobs=new Map<string,string>();let uploads=0;
  const service={uploadFeatureBlob:async(_chat:string,id:string,data:string)=>{uploads++;blobs.set(id,data);},downloadFeatureBlob:async(_chat:string,id:string)=>{const data=blobs.get(id);if(!data)throw Error('missing');return data;}} as unknown as ConversationServiceLike;
  return {service,blobs,attachments:createFeatureAttachments(service,chat,()=>live),lock:()=>{live=false;},uploads:()=>uploads};
}
const input={uri:'file:///source.txt',name:'notes.txt',mime:'text/plain',kind:'document' as const};
it('round trips authenticated files through opaque blob storage with fresh keys',async()=>{
  const f=fixture(); files.set(input.uri,Buffer.from('private notes'));
  const first=await f.attachments.prepare(input),second=await f.attachments.prepare(input);
  expect(first.key).not.toBe(second.key);expect(first.nonce).not.toBe(second.nonce);expect(first.blobId).not.toBe(second.blobId);
  expect(Buffer.from(f.blobs.get(first.blobId)!,'base64').includes(Buffer.from('private notes'))).toBe(false);
  const path=await f.attachments.open(first);expect(files.get(path)?.toString()).toBe('private notes');
  expect([...files.keys()].some(path=>path.includes('/out/'))).toBe(false);
  await f.attachments.wipeOpened();expect(files.has(path)).toBe(false);
});
it('rejects wrong keys, nonces, metadata, hash, size, and modified ciphertext',async()=>{
  const f=fixture();files.set(input.uri,Buffer.from('private notes'));const file=await f.attachments.prepare(input);
  const verified=await f.attachments.open(file);
  for(const change of [{key:'A'.repeat(43)+'='},{nonce:'A'.repeat(32)},{mime:'application/pdf'},{sha256:'0'.repeat(64)},{size:999}]){
    await expect(f.attachments.open({...file,...change})).rejects.toThrow();
  }
  await f.attachments.wipeOpened();expect(files.has(verified)).toBe(false);
  const bytes=Buffer.from(f.blobs.get(file.blobId)!,'base64');bytes[bytes.length-1]^=1;f.blobs.set(file.blobId,bytes.toString('base64'));
  await expect(f.attachments.open(file)).rejects.toThrow();
  expect([...files.keys()].some(path=>path.includes('/open/'))).toBe(false);
});
it('binds ciphertext to its conversation and rejects oversized or missing files before upload',async()=>{
  const f=fixture();files.set(input.uri,Buffer.from('private notes'));const file=await f.attachments.prepare(input);
  const other=createFeatureAttachments(f.service,'00000000-0000-4000-8000-000000000002',()=>true);
  await expect(other.open(file)).rejects.toThrow();
  files.delete(input.uri);await expect(f.attachments.prepare(input)).rejects.toThrow();
  files.set(input.uri,Buffer.alloc(25*1024*1024+1));await expect(f.attachments.prepare(input)).rejects.toThrow();expect(f.uploads()).toBe(1);
});
it('a locked gate prevents access to cached plaintext and new uploads',async()=>{
  const f=fixture();files.set(input.uri,Buffer.from('private notes'));const file=await f.attachments.prepare(input);const path=await f.attachments.open(file);
  f.lock();await expect(f.attachments.open(file)).rejects.toThrow();await expect(f.attachments.prepare(input)).rejects.toThrow();
  await f.attachments.wipeOpened();expect(files.has(path)).toBe(false);
});
it('permission denial prevents saving plaintext to the gallery',async()=>{
  const f=fixture();files.set(input.uri,Buffer.from('private notes'));const file=await f.attachments.prepare(input);
  await expect(f.attachments.saveToDevice(file)).rejects.toThrow();
});
it('a download finishing after cache wipe cannot restore plaintext',async()=>{
  const f=fixture();files.set(input.uri,Buffer.from('private notes'));const file=await f.attachments.prepare(input);
  let release!:(data:string)=>void;let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  f.service.downloadFeatureBlob=async()=>{entered();return new Promise<string>(resolve=>{release=resolve;});};
  const opening=f.attachments.open(file);await started;await f.attachments.wipeOpened();release(f.blobs.get(file.blobId)!);
  await expect(opening).rejects.toThrow();expect([...files.keys()].some(path=>path.includes('/open/'))).toBe(false);
});


