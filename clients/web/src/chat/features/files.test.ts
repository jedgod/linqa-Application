// @ts-nocheck -- Tests interoperate with the mobile implementation and use Node fixtures.
import {describe,it,expect,vi} from 'vitest';
import {DesktopFiles,b64d,b64e} from './files';
import {validateContent} from './codec';
import {validateContent as mobileValidate} from '../../../../mobile/features/conversation/content/codec';
import {encryptMediaBytes,decryptMediaBytes} from '../../../../mobile/services/conversation-file-crypto';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
const chat='00000000-0000-4000-8000-000000000001';
const id='00000000-0000-4000-8000-000000000002';
const bytes=new TextEncoder().encode('private file contents');
const arrayBuffer=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsArrayBuffer(blob);});
describe('desktop/mobile encrypted attachment interoperability',()=>{
 it('desktop upload opens with the actual mobile file crypto and contains no plaintext at the blob API',async()=>{
  let envelope='';const api={uploadFeatureBlob:vi.fn(async(c,i,e)=>{expect(c).toBe(chat);envelope=e;})};
  const file={name:'private.txt',type:'text/plain',size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
  const c=await new DesktopFiles(api,chat).upload(file);
  expect(mobileValidate(c)).toEqual(c);expect(envelope).not.toContain('private file contents');
  const opened=decryptMediaBytes(envelope,c.key,{conversationId:chat,senderUserId:'linqa-feature-file-v1',mediaId:c.blobId,mimeType:c.mime});
  expect(Array.from(b64d(opened))).toEqual(Array.from(bytes));
 });
 it('mobile ciphertext opens on desktop only in its bound conversation and with matching size/hash/nonce',async()=>{
  const key=crypto.getRandomValues(new Uint8Array(32)),nonce=crypto.getRandomValues(new Uint8Array(24));
  const sealed=encryptMediaBytes(b64e(bytes),{conversationId:chat,senderUserId:'linqa-feature-file-v1',mediaId:id,mimeType:'text/plain'},key,nonce);
  const file={type:'file',fileKind:'document',name:'private.txt',mime:'text/plain',size:bytes.length,blobId:id,key:sealed.key,nonce:b64e(nonce),sha256:bytesToHex(sha256(bytes))};
  const api={downloadFeatureBlob:async()=>sealed.envelope};
  expect(Array.from(new Uint8Array(await arrayBuffer(await new DesktopFiles(api,chat).open(file))))).toEqual(Array.from(bytes));
  await expect(new DesktopFiles(api,id).open(file)).rejects.toThrow();
  await expect(new DesktopFiles(api,chat).open({...file,sha256:'0'.repeat(64)})).rejects.toThrow('integrity');
  await expect(new DesktopFiles(api,chat).open({...file,size:bytes.length+1})).rejects.toThrow('integrity');
 });
 it('both clients accept browser voice/video codecs and reject invalid keys and oversize files',()=>{
  const base={type:'file',name:'voice.webm',size:10,blobId:id,key:b64e(new Uint8Array(32)),nonce:b64e(new Uint8Array(24)),sha256:'0'.repeat(64)};
  for(const c of [{...base,fileKind:'voice',mime:'audio/webm',durationMs:1000},{...base,fileKind:'video',mime:'video/webm',durationMs:1000}]){expect(validateContent(c)).not.toBeNull();expect(mobileValidate(c)).not.toBeNull();}
  expect(validateContent({...base,fileKind:'voice',mime:'audio/webm',key:'bad'})).toBeNull();
  expect(mobileValidate({...base,fileKind:'voice',mime:'audio/webm',durationMs:300001})).toBeNull();
 });
 it('does not upload empty or oversized files',async()=>{const api={uploadFeatureBlob:vi.fn()};for(const size of [0,25*1024*1024+1])await expect(new DesktopFiles(api,chat).upload({size})).rejects.toThrow();expect(api.uploadFeatureBlob).not.toHaveBeenCalled();});
});
